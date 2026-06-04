/**
 * Central tunables. EDIT model I/O here after inspecting your .tflite in Netron.
 */

export const MODEL = {
  // Recognition model input — confirm in Netron.
  inputSize: 112, // 112x112 is standard for MobileFaceNet / ArcFace-lite
  // Output embedding dimension — confirm in Netron (128 for MobileFaceNet, 512 for ArcFace).
  embeddingDim: 128,
  // Pixel normalization applied before inference: (px - mean) / std
  mean: 127.5,
  std: 128.0,
};

export const RECOGNITION = {
  // Cosine similarity above this AND liveness passed => accept.
  // Tune on your test set via the ROC curve; 0.5–0.65 is typical for MobileFaceNet.
  matchThreshold: 0.55,
  // Number of samples averaged into the enrollment template.
  enrollmentSamples: 5,
};

export const LIVENESS = {
  // Blink: eye-open probability must drop below this then rise above openProb.
  blinkClosedProb: 0.2,
  blinkOpenProb: 0.7,
  // Head turn: absolute yaw (degrees) must exceed this.
  yawThresholdDeg: 22,
  // Smile probability must exceed this.
  smileProb: 0.7,
  // Each challenge must complete within this many ms (anti-replay timing).
  challengeTimeoutMs: 6000,
  // Frame-consistency: same tracked faceId must persist; reject if it jumps.
  requireStableTrackingId: true,
};

export const SYNC = {
  endpoint: 'https://YOUR_API_ID.execute-api.ap-south-1.amazonaws.com/prod/records',
  maxRetries: 6,
  baseBackoffMs: 1000, // exponential: base * 2^attempt, capped
  maxBackoffMs: 60000,
};

// Keychain service name under which the device secret (HMAC + MMKV key) is stored.
export const KEYCHAIN_SERVICE = 'com.offlinefaceauth.devicesecret';
