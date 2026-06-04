import React, {useEffect, useState} from 'react';
import {ActivityIndicator, View, Text, StyleSheet} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';

import {initStorage} from './src/services/encryptedStorage';
import {startAutoSync} from './src/services/syncService';
import EnrollmentScreen from './src/screens/EnrollmentScreen';
import AuthScreen from './src/screens/AuthScreen';
import QueueScreen from './src/screens/QueueScreen';
import BenchmarkScreen from './src/screens/BenchmarkScreen';

const Stack = createNativeStackNavigator();

function Home({navigation}: any) {
  const items = [
    ['Authenticate', 'Auth'],
    ['Enroll employee', 'Enrollment'],
    ['Offline queue', 'Queue'],
    ['Benchmark', 'Benchmark'],
  ];
  return (
    <View style={styles.home}>
      <Text style={styles.title}>Offline FaceAuth</Text>
      <Text style={styles.sub}>Datalake 3.0 · offline-ready</Text>
      {items.map(([label, route]) => (
        <Text key={route} style={styles.link} onPress={() => navigation.navigate(route)}>
          {label}
        </Text>
      ))}
    </View>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      await initStorage();
      startAutoSync();
      setReady(true);
    })();
  }, []);

  if (!ready) {
    return (
      <View style={[styles.home, {justifyContent: 'center'}]}>
        <ActivityIndicator size="large" />
        <Text style={{marginTop: 12, color: '#666'}}>Loading secure store + model…</Text>
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={Home} options={{title: 'Offline FaceAuth'}} />
        <Stack.Screen name="Auth" component={AuthScreen} options={{title: 'Authenticate'}} />
        <Stack.Screen name="Enrollment" component={EnrollmentScreen} options={{title: 'Enroll'}} />
        <Stack.Screen name="Queue" component={QueueScreen} options={{title: 'Offline Queue'}} />
        <Stack.Screen name="Benchmark" component={BenchmarkScreen} options={{title: 'Benchmark'}} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  home: {flex: 1, padding: 28, backgroundColor: '#fff'},
  title: {fontSize: 30, fontWeight: '800', color: '#1a3a5f', marginTop: 40},
  sub: {color: '#777', marginBottom: 28},
  link: {fontSize: 18, color: '#1a3a5f', paddingVertical: 16, borderBottomWidth: 1, borderColor: '#eee'},
});
