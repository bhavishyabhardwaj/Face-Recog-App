import React, {useEffect, useRef, useState, useCallback} from 'react';
import {StyleSheet, Text, View, TouchableOpacity} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import {useFaceDetector, FaceDetectionOptions} from 'react-native-vision-camera-face-detector';
import {useTensorflowModel} from 'react-native-fast-tflite';
import {useResizePlugin} from 'vision-camera-resize-plugin';
import {useSharedValue} from 'react-native-reanimated';
import {Worklets} from 'react-native-worklets-core';

import {MODEL} from '../config';
import {LivenessSession, DetectionFrame} from '../services/livenessService';
import {toEmbedding, matchEmployee, MODEL_VERSION} from '../services/faceRecognition';
import {Benchmark} from '../services/benchmarkService';
import {
  AuthRecord,
  enqueueRecord,
  getDeviceId,
  appendAudit,
} from '../services/encryptedStorage';
import {signRecord} from '../services/recordSigner';

// Hard-coded demo employee; in production this comes from a login/badge scan.
const DEMO_EMPLOYEE = 'EMP001';

type Phase = 'liveness' | 'capturing' | 'result';

export default function AuthScreen() {
  const {hasPermission, requestPermission} = useCameraPermission();
  const device = useCameraDevice('front');

  const faceOptions = useRef<FaceDetectionOptions>({
    performanceMode: 'fast',
    classificationMode: 'all', // enables eye-open + smile probabilities
    landmarkMode: 'none',
    contourMode: 'none',
    trackingEnabled: true, // gives a stable trackingId for frame consistency
  }).current;
  const {detectFaces} = useFaceDetector(faceOptions);

  const model = useTensorflowModel(require('../assets/models/mobilefacenet.tflite'));
  const {resize} = useResizePlugin();

  const captureNow = useSharedValue(false); // worklet-readable flag
  const session = useRef(new LivenessSession()).current;

  const [phase, setPhase] = useState<Phase>('liveness');
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<null | {
    verified: boolean;
    similarity: number;
    timeMs: number;
  }>(null);

  const startTime = useRef(0);
  const livenessDoneAt = useRef(0);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  useEffect(() => {
    session.start();
    setPrompt(session.prompt);
    startTime.current = Date.now();
  }, [session]);

  // Called from the worklet for each detected face (and embedding when capturing).
  const onFrame = useCallback(
    (payload: {detection: DetectionFrame; embedding: number[] | null}) => {
      if (phase === 'liveness') {
        const state = session.update(payload.detection);
        setPrompt(session.prompt);
        if (state === 'passed') {
          livenessDoneAt.current = Date.now();
          setPhase('capturing');
          captureNow.value = true; // tell worklet to start producing embeddings
        } else if (state === 'failed') {
          appendAudit({event: 'liveness_failed', employee: DEMO_EMPLOYEE});
          Benchmark.recordSpoof(true);
          finish({verified: false, similarity: 0});
        }
      } else if (phase === 'capturing' && payload.embedding) {
        captureNow.value = false;
        const recogStart = Date.now();
        const live = toEmbedding(payload.embedding);
        const m = matchEmployee(live, DEMO_EMPLOYEE);
        const recogMs = Date.now() - recogStart;
        const livenessMs = livenessDoneAt.current - startTime.current;
        const endToEnd = Date.now() - startTime.current;
        Benchmark.recordTiming(recogMs, livenessMs, endToEnd);

        if (m && m.matched) {
          Benchmark.recordOutcome('trueAccept');
          finish({verified: true, similarity: m.similarity});
          void saveRecord(m.similarity);
        } else {
          Benchmark.recordOutcome('falseReject');
          finish({verified: false, similarity: m?.similarity ?? 0});
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phase],
  );

  // Keep a ref to the latest onFrame so the (stable) worklet bridge always
  // dispatches into the current closure without being recreated each render.
  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);
  const onFrameJS = useRef(
    Worklets.createRunOnJS((payload: {detection: DetectionFrame; embedding: number[] | null}) =>
      onFrameRef.current(payload),
    ),
  ).current;

  function finish(r: {verified: boolean; similarity: number}) {
    setResult({...r, timeMs: Date.now() - startTime.current});
    setPhase('result');
  }

  async function saveRecord(similarity: number) {
    const base = {
      id: 'rec_' + Date.now().toString(36),
      employeeId: DEMO_EMPLOYEE,
      timestamp: new Date().toISOString(),
      deviceId: getDeviceId(),
      modelVersion: MODEL_VERSION,
      livenessPassed: true,
      confidence: similarity,
      challengeSequence: session.challenges,
      gps: null as null | {lat: number; lng: number},
    };
    const signature = await signRecord(base);
    const rec: AuthRecord = {...base, signature, status: 'pending', retryCount: 0};
    enqueueRecord(rec);
  }

  function retry() {
    setResult(null);
    session.start();
    setPrompt(session.prompt);
    startTime.current = Date.now();
    setPhase('liveness');
  }

  const frameProcessor = useFrameProcessor(
    frame => {
      'worklet';
      const faces = detectFaces(frame);
      if (faces.length !== 1) return; // require exactly one clear face
      const face: any = faces[0];

      const detection: DetectionFrame = {
        leftEyeOpenProbability: face.leftEyeOpenProbability ?? 1,
        rightEyeOpenProbability: face.rightEyeOpenProbability ?? 1,
        smilingProbability: face.smilingProbability ?? 0,
        yawAngle: face.yawAngle ?? 0,
        trackingId: face.trackingId,
      };

      let embedding: number[] | null = null;
      if (captureNow.value && model.state === 'loaded') {
        const b = face.bounds;
        // Crop to the face box, scale to model input, RGB float32.
        const resized = resize(frame, {
          crop: {x: b.x, y: b.y, width: b.width, height: b.height},
          scale: {width: MODEL.inputSize, height: MODEL.inputSize},
          pixelFormat: 'rgb',
          dataType: 'float32',
        });
        // Normalize (px - mean) / std into the model's input buffer.
        const input = new Float32Array(MODEL.inputSize * MODEL.inputSize * 3);
        for (let i = 0; i < input.length; i++) {
          input[i] = (resized[i] - MODEL.mean) / MODEL.std;
        }
        const out = model.model.runSync([input]);
        embedding = Array.from(out[0] as Float32Array);
      }

      onFrameJS({detection, embedding});
    },
    [detectFaces, resize, model, onFrameJS],
  );

  if (!hasPermission) {
    return <Centered text="Camera permission required." />;
  }
  if (device == null) {
    return <Centered text="No front camera found." />;
  }

  return (
    <View style={styles.fill}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={phase !== 'result'}
        frameProcessor={frameProcessor}
        pixelFormat="yuv"
      />
      <View style={styles.overlay}>
        {phase === 'liveness' && (
          <>
            <Text style={styles.badge}>Liveness {session.progress}</Text>
            <Text style={styles.prompt}>{prompt}</Text>
          </>
        )}
        {phase === 'capturing' && <Text style={styles.prompt}>Hold still — matching…</Text>}
        {phase === 'result' && result && (
          <View style={styles.resultCard}>
            <Text style={[styles.verdict, {color: result.verified ? '#1e8e3e' : '#d93025'}]}>
              {result.verified ? 'VERIFIED' : 'NOT VERIFIED'}
            </Text>
            <Text style={styles.detail}>Confidence: {result.similarity.toFixed(3)}</Text>
            <Text style={styles.detail}>Time: {result.timeMs} ms</Text>
            <Text style={styles.detail}>Challenges: {session.challenges.join(' + ')}</Text>
            <TouchableOpacity style={styles.btn} onPress={retry}>
              <Text style={styles.btnText}>Run again</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

function Centered({text}: {text: string}) {
  return (
    <View style={[styles.fill, styles.center]}>
      <Text style={styles.detail}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1, backgroundColor: '#000'},
  center: {alignItems: 'center', justifyContent: 'center'},
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 24,
    alignItems: 'center',
  },
  badge: {
    color: '#fff',
    backgroundColor: 'rgba(26,58,95,0.8)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 8,
  },
  prompt: {color: '#fff', fontSize: 22, fontWeight: '700', textAlign: 'center'},
  resultCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    width: '100%',
  },
  verdict: {fontSize: 28, fontWeight: '800', marginBottom: 8},
  detail: {fontSize: 15, color: '#333', marginVertical: 2},
  btn: {marginTop: 16, backgroundColor: '#1a3a5f', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10},
  btnText: {color: '#fff', fontWeight: '700'},
});
