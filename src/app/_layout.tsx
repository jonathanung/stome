import { SQLiteProvider } from 'expo-sqlite';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Component, Suspense, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { expoDriver } from '../db/expo-driver';
import { migrateDb } from '../db/migrate';
import { DATABASE_NAME } from '../db/schema';

type BoundaryState = {
  error: Error | null;
};

class DatabaseBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.centered}>
          <Text accessibilityRole="alert">Could not open the local database.</Text>
          <Text>{this.state.error.message}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

function Opening() {
  return (
    <View style={styles.centered}>
      <ActivityIndicator />
      <Text>Opening local notes…</Text>
    </View>
  );
}

export default function RootLayout() {
  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      <DatabaseBoundary>
        <Suspense fallback={<Opening />}>
          <SQLiteProvider databaseName={DATABASE_NAME} onInit={(db) => migrateDb(expoDriver(db))} useSuspense>
            <Stack screenOptions={{ headerTitle: 'stome', headerStyle: { backgroundColor: '#f6f4ee' }, headerTintColor: '#292820' }} />
          </SQLiteProvider>
        </Suspense>
      </DatabaseBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#ffffff',
    flex: 1,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
    padding: 24,
  },
});
