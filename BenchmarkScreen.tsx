import React, {useCallback, useEffect, useState} from 'react';
import {StyleSheet, Text, View, ScrollView, TouchableOpacity, Platform} from 'react-native';
import {Benchmark} from '../services/benchmarkService';
import {MODEL_VERSION} from '../services/faceRecognition';

export default function BenchmarkScreen() {
  const [s, setS] = useState(Benchmark.summary());

  const refresh = useCallback(() => setS(Benchmark.summary()), []);
  useEffect(() => {
    const t = setInterval(refresh, 1000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <ScrollView style={styles.fill} contentContainerStyle={{padding: 20}}>
      <Text style={styles.h1}>Benchmark Dashboard</Text>
      <Metric label="Model" value={MODEL_VERSION} />
      <Metric label="Device" value={`${Platform.OS} ${Platform.Version}`} />
      <Metric label="Attempts measured" value={String(s.attempts)} />
      <Metric label="Avg recognition" value={`${s.avgRecognitionMs} ms`} />
      <Metric label="Avg liveness" value={`${s.avgLivenessMs} ms`} />
      <Metric label="Avg end-to-end" value={`${s.avgEndToEndMs} ms`} highlight={s.avgEndToEndMs < 1000} />
      <Metric label="False accept rate" value={s.far.toFixed(3)} />
      <Metric label="False reject rate" value={s.frr.toFixed(3)} />
      <Metric label="Spoofs blocked" value={String(s.spoofBlocked)} />
      <Metric label="Spoofs passed" value={String(s.spoofPassed)} highlight={s.spoofPassed === 0} />

      <Text style={styles.note}>
        Model file size: read the .tflite asset size for the slide (e.g. via
        react-native-fs stat on the bundled asset). Target ≈ 20 MB or less.
      </Text>

      <TouchableOpacity style={styles.btn} onPress={() => {Benchmark.reset(); refresh();}}>
        <Text style={styles.btnText}>Reset stats</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Metric({label, value, highlight}: {label: string; value: string; highlight?: boolean}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, highlight && {color: '#1e8e3e'}]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1, backgroundColor: '#fff'},
  h1: {fontSize: 22, fontWeight: '800', marginBottom: 16, color: '#1a3a5f'},
  metric: {flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderColor: '#eee'},
  metricLabel: {color: '#555', fontSize: 15},
  metricValue: {fontWeight: '700', fontSize: 15, color: '#222'},
  note: {marginTop: 16, color: '#888', fontSize: 13, lineHeight: 18},
  btn: {marginTop: 24, backgroundColor: '#d93025', padding: 12, borderRadius: 10, alignItems: 'center'},
  btnText: {color: '#fff', fontWeight: '700'},
});
