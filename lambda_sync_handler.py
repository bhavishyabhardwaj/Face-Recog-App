"""
AWS Lambda sync handler for Offline FaceAuth.

API Gateway (POST /records) -> this Lambda -> DynamoDB.
Verifies the device HMAC seal before accepting, so tampered records are rejected
(HTTP 400) and genuine ones confirmed (HTTP 200). The app purges its local copy
ONLY on a 200.

Per-device secrets are provisioned out of band (e.g. seeded into DynamoDB table
`faceauth-devices` at enrollment time) and must match the device's keystore
secret used by recordSigner.ts.

Env vars:
  RECORDS_TABLE  = faceauth-records
  DEVICES_TABLE  = faceauth-devices   (deviceId -> secret)
"""
import json
import hmac
import hashlib
import os

import boto3

dynamo = boto3.resource("dynamodb")
records_table = dynamo.Table(os.environ.get("RECORDS_TABLE", "faceauth-records"))
devices_table = dynamo.Table(os.environ.get("DEVICES_TABLE", "faceauth-devices"))

# Field order MUST match canonicalPayload() in src/services/recordSigner.ts.
SIGNED_FIELDS = [
    "id", "employeeId", "timestamp", "deviceId",
    "modelVersion", "livenessPassed", "confidence",
    "challengeSequence", "gps",
]


def _resp(code, body):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def _canonical(rec):
    # Mirror the client: confidence fixed to 6 dp, gps defaults to None.
    payload = {
        "id": rec["id"],
        "employeeId": rec["employeeId"],
        "timestamp": rec["timestamp"],
        "deviceId": rec["deviceId"],
        "modelVersion": rec["modelVersion"],
        "livenessPassed": rec["livenessPassed"],
        "confidence": round(float(rec["confidence"]), 6),
        "challengeSequence": rec["challengeSequence"],
        "gps": rec.get("gps"),
    }
    return json.dumps(payload, separators=(",", ":"))


def _device_secret(device_id):
    item = devices_table.get_item(Key={"deviceId": device_id}).get("Item")
    return item.get("secret") if item else None


def handler(event, _context):
    try:
        rec = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _resp(400, {"error": "invalid_json"})

    missing = [f for f in SIGNED_FIELDS if f not in rec and f != "gps"]
    if missing or "signature" not in rec:
        return _resp(400, {"error": "missing_fields", "fields": missing})

    secret = _device_secret(rec["deviceId"])
    if not secret:
        return _resp(403, {"error": "unknown_device"})

    expected = hmac.new(
        secret.encode("utf-8"), _canonical(rec).encode("utf-8"), hashlib.sha256
    ).hexdigest()

    # Constant-time compare; reject tampered/forged records.
    if not hmac.compare_digest(expected, rec["signature"]):
        return _resp(400, {"error": "signature_mismatch"})

    # Idempotent upsert keyed by record id.
    records_table.put_item(
        Item={
            "id": rec["id"],
            "employeeId": rec["employeeId"],
            "timestamp": rec["timestamp"],
            "deviceId": rec["deviceId"],
            "modelVersion": rec["modelVersion"],
            "livenessPassed": rec["livenessPassed"],
            "confidence": str(rec["confidence"]),
            "challengeSequence": rec["challengeSequence"],
            "gps": rec.get("gps"),
        }
    )
    return _resp(200, {"status": "confirmed", "id": rec["id"]})
