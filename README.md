# Offline FaceAuth for Datalake 3.0 — NHAI Hackathon 7.0

A React Native app that authenticates field personnel **fully offline** using
face recognition + challenge–response liveness, stores only encrypted results
locally, and syncs/purges to AWS when connectivity returns.

> **Architecture note:** There is **no custom native inference module**. All AI
> runs in JS via JSI worklets. This removes the slowest, riskiest part of the
> original blueprint (`FaceInferenceModule.kt/.swift`) and is why this can be
> finished in the remaining hackathon window.

## Stack

| Layer            | Library                                   | Why |
|------------------|-------------------------------------------|-----|
| Camera + worklets| `react-native-vision-camera` v4           | Real-time frame processors |
| Face detect + liveness signals | `react-native-vision-camera-face-detector` (ML Kit) | Offline; gives eye-open / smile / yaw directly |
| Recognition model| `react-native-fast-tflite`                | Runs MobileFaceNet TFLite via JSI |
| Frame resize/crop| `vision-camera-resize-plugin`             | GPU crop face → 112×112 RGB |
| Encrypted storage| `react-native-mmkv` (+ `react-native-keychain`) | Encrypted templates + sync queue |
| Signing          | `crypto-js`                               | HMAC-SHA256 tamper seal (pure JS, no native build) |
| Network state    | `@react-native-community/netinfo`         | Drives sync trigger |

## 1. Install

```bash
npx @react-native-community/cli init OfflineFaceAuth --version latest
cd OfflineFaceAuth
# copy the src/, scripts/, aws/, App.tsx, babel.config.js from this package in

npm i react-native-vision-camera react-native-vision-camera-face-detector \
      react-native-fast-tflite vision-camera-resize-plugin \
      react-native-worklets-core react-native-reanimated \
      react-native-mmkv react-native-keychain \
      @react-native-community/netinfo crypto-js \
      @react-navigation/native @react-navigation/native-stack \
      react-native-screens react-native-safe-area-context
npm i -D @types/crypto-js
```

### babel.config.js
Already provided — it registers the worklets and reanimated plugins (order matters; reanimated must be **last**).

### Permissions
- **Android** `android/app/src/main/AndroidManifest.xml`: `<uses-permission android:name="android.permission.CAMERA" />`
- **iOS** `ios/.../Info.plist`: `NSCameraUsageDescription` = "Used for offline employee authentication."

### New Architecture
fast-tflite + vision-camera v4 work best with the New Architecture (RN 0.76+ has it on by default). Leave it on.

## 2. Get / convert the recognition model

You need `src/assets/models/mobilefacenet.tflite`. Use `scripts/convert_model.py`:

```bash
pip install tensorflow numpy
python scripts/convert_model.py --out src/assets/models/mobilefacenet.tflite
```

It produces a **float16-quantized** MobileFaceNet (~2 MB, float I/O, simple +
accurate). Full INT8 is available via `--int8` but then the input must be fed as
`uint8` and the output dequantized — see comments in the script. Whichever you
pick, **open the file in https://netron.app and confirm the input shape
(expected 1×112×112×3) and output dim (128 or 512)**, then set those in
`src/config.ts`.

## 3. Run

```bash
npm run android   # or: npm run ios
```

## 4. Demo flow (matches the judge script)
1. Airplane mode ON → open app → Splash shows "model loaded, offline ready".
2. **Enroll** a user (captures 3–5 embeddings, averages, encrypts, stores).
3. **Authenticate** → random challenge (blink / turn / smile) → match → record saved to encrypted queue.
4. **Spoof test** → printed photo / phone screen → liveness fails.
5. Network ON → Queue screen auto-syncs → server confirms → local record purged.
6. **Benchmark** screen shows model size, avg recognition ms, avg liveness ms, FAR/FRR counts.

## 5. What I could NOT compile here
This codebase was written without an Android/iOS build environment, so treat the
**tensor I/O specifics as the one thing to verify**: confirm your `.tflite`
input dtype/shape and output dimension in Netron, then reconcile `config.ts` and
the normalization in `faceRecognition.ts`. Everything else (liveness state
machine, encryption, queue, sync/purge, signing, screens) is complete.

## Folder map
```
src/
  config.ts                 model + threshold constants (EDIT after Netron check)
  screens/                  Enrollment, Auth, Queue, Benchmark
  services/                 faceRecognition, liveness, encryptedStorage, sync, benchmark, recordSigner
  utils/                    cosineSimilarity, networkStatus
  assets/models/            put mobilefacenet.tflite here
scripts/convert_model.py    MobileFaceNet -> TFLite (fp16 or int8)
aws/lambda_sync_handler.py  ingest signed records, verify HMAC, store, confirm
```
