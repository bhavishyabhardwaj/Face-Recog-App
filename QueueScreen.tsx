import React, {useCallback, useEffect, useState} from 'react';
import {StyleSheet, Text, View, FlatList, TouchableOpacity, RefreshControl} from 'react-native';
import {getQueue, queueCounts, AuthRecord} from '../services/encryptedStorage';
import {syncNow} from '../services/syncService';

export default function QueueScreen() {
  const [records, setRecords] = useState<AuthRecord[]>([]);
  const [counts, setCounts] = useState({pending: 0, synced: 0, failed: 0});
  const [status, setStatus] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => {
    setRecords(getQueue());
    setCounts(queueCounts());
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [refresh]);

  const onSync = useCallback(async () => {
    setRefreshing(true);
    await syncNow(msg => setStatus(msg));
    refresh();
    setRefreshing(false);
  }, [refresh]);

  return (
    <View style={styles.fill}>
      <View style={styles.summary}>
        <Stat label="Pending" value={counts.pending} color="#e8a317" />
        <Stat label="Synced" value={counts.synced} color="#1e8e3e" />
        <Stat label="Failed" value={counts.failed} color="#d93025" />
      </View>
      <TouchableOpacity style={styles.btn} onPress={onSync}>
        <Text style={styles.btnText}>Sync now</Text>
      </TouchableOpacity>
      {!!status && <Text style={styles.status}>{status}</Text>}
      <FlatList
        data={records}
        keyExtractor={r => r.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onSync} />}
        ListEmptyComponent={<Text style={styles.empty}>Queue empty — records purge after server confirms.</Text>}
        renderItem={({item}) => (
          <View style={styles.row}>
            <View style={{flex: 1}}>
              <Text style={styles.rowTitle}>{item.employeeId} · {item.id}</Text>
              <Text style={styles.rowMeta}>
                {new Date(item.timestamp).toLocaleString()} · conf {item.confidence.toFixed(3)}
              </Text>
            </View>
            <Text style={[styles.tag, tagStyle(item.status)]}>{item.status}</Text>
          </View>
        )}
      />
    </View>
  );
}

function Stat({label, value, color}: {label: string; value: number; color: string}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, {color}]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function tagStyle(s: string) {
  if (s === 'synced') return {backgroundColor: '#e6f4ea', color: '#1e8e3e'};
  if (s === 'failed') return {backgroundColor: '#fce8e6', color: '#d93025'};
  return {backgroundColor: '#fef7e0', color: '#b06000'};
}

const styles = StyleSheet.create({
  fill: {flex: 1, backgroundColor: '#fff', padding: 16},
  summary: {flexDirection: 'row', justifyContent: 'space-around', marginBottom: 12},
  stat: {alignItems: 'center'},
  statValue: {fontSize: 28, fontWeight: '800'},
  statLabel: {color: '#666'},
  btn: {backgroundColor: '#1a3a5f', padding: 14, borderRadius: 10, alignItems: 'center'},
  btnText: {color: '#fff', fontWeight: '700'},
  status: {marginTop: 8, color: '#444', textAlign: 'center'},
  empty: {textAlign: 'center', color: '#888', marginTop: 40},
  row: {flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderColor: '#eee'},
  rowTitle: {fontWeight: '600', color: '#222'},
  rowMeta: {color: '#777', fontSize: 12, marginTop: 2},
  tag: {paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: 'hidden', fontSize: 12, fontWeight: '700'},
});
