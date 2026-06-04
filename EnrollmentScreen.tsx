import React, {useEffect, useRef, useState, useCallback} from 'react';
import {StyleSheet, Text, View, TouchableOpacity, TextInput, Alert} from 'react-native';
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
import {buildTemplate, ENROLLMENT_SAMPLES, toEmbedding} from '../services/faceRecognition';
import {saveTemplate} from '../services/encryptedStorage';

/**
 * Admin enrollment: capture ENROLLMENT_SAMPLES embeddings of one employee,
 * average them into a template, encrypt and store. Raw images are never kept.
 */
export default function EnrollmentScreen() {
  const {hasPermission, requestPermission} = useCameraPermission();
  const device = useCameraDevice('front');
  const faceOptions = useRef<FaceDetectionOptions>({
    performanceMode: 'accurate',
    landmarkMode: 'none',
    classificationMode: 'none',
    trackingEnabled: false,
  }).current;
  const {detectFaces} = useFaceDetector(faceOptions);
  const model = useTensorflowModel(require('../assets/models/mobilefacenet.tflite'));
  const {resize} = useResizePlugin();

  const capture = useSharedValue(false);
  const [employeeId, setEmployeeId] = useState('EMP001');
  const [samples, setSamples] = useState<number[][]>([]);
  const samplesRef = useRef<number[][]>([]);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  const onEmbedding = useCallback((embedding: number[]) => {
    capture.value = false;
    const next = [...samplesRef.current, toEmbedding(embedding)];
    samplesRef.current = next;
    setSamples(next);
    if (next.length >= ENROLLMENT_SAMPLES) {
      const tpl = buildTemplate(employeeIdRef.current, next);
      saveTemplate(tpl);
      Alert.alert('Enrolled', `${tpl.employeeId} stored with ${next.length} samples (encrypted).`);
      samplesRef.current = [];
      setSamples([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const employeeIdRef = useRef(employeeId);
  useEffect(() => {
    employeeIdRef.current = employeeId;
  }, [employeeId]);

  const onEmbeddingJS = useRef(Worklets.createRunOnJS(onEmbedding)).current;

  const frameProcessor = useFrameProcessor(
    frame => {
      'worklet';
      if (!capture.value || model.state !== 'loaded') return;
      const faces = detectFaces(frame);
      if (faces.length !== 1) return;
      const b: any = faces[0].bounds;
      const resized = resize(frame, {
        crop: {x: b.x, y: b.y, width: b.width, height: b.height},
        scale: {width: MODEL.inputSize, height: MODEL.inputSize},
        pixelFormat: 'rgb',
        dataType: 'float32',
      });
      const input = new Float32Array(MODEL.inputSize * MODEL.inputSize * 3);
      for (let i = 0; i < input.length; i++) input[i] = (resized[i] - MODEL.mean) / MODEL.std;
      const out = model.model.runSync([input]);
      onEmbeddingJS(Array.from(out[0] as Float32Array));
    },
    [detectFaces, resize, model, onEmbeddingJS],
  );

  if (!hasPermission || device == null) {
    return (
      <View style={[styles.fill, styles.center]}>
        <Text>Camera unavailable.</Text>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <Camera style={StyleSheet.absoluteFill} device={device} isActive frameProcessor={frameProcessor} pixelFormat="yuv" />
      <View style={styles.panel}>
        <TextInput
          style={styles.input}
          value={employeeId}
          onChangeText={setEmployeeId}
          placeholder="Employee ID"
          placeholderTextColor="#999"
          autoCapitalize="characters"
        />
        <Text style={styles.count}>
          Samples: {samples.length} / {ENROLLMENT_SAMPLES}
        </Text>
        <TouchableOpacity style={styles.btn} onPress={() => (capture.value = true)}>
          <Text style={styles.btnText}>Capture sample</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1, backgroundColor: '#000'},
  center: {alignItems: 'center', justifyContent: 'center'},
  panel: {position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, backgroundColor: 'rgba(255,255,255,0.95)'},
  input: {borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginBottom: 12, color: '#000'},
  count: {textAlign: 'center', marginBottom: 12, fontWeight: '600'},
  btn: {backgroundColor: '#1a3a5f', padding: 14, borderRadius: 10, alignItems: 'center'},
  btnText: {color: '#fff', fontWeight: '700'},
});
