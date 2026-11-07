import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Component, Suspense, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { ThemeProvider } from '../../design-theme/src/primitives';
import { expoDriver } from '../db/expo-driver';
import { migrateDb } from '../db/migrate';
import { DATABASE_NAME } from '../db/schema';
import { classifyStorageFailure, createStorageRetryGate, finishStartup } from '../db/storage-startup';
import { QuickCapture } from '../features/capture/QuickCapture';
import { StorageOpening, StorageStartupScreen } from '../screens/StorageStartup';

function prepareDatabase(db: SQLiteDatabase): Promise<void> {
  return finishStartup(
    db,
    (database) => migrateDb(expoDriver(database)),
    (database) => database.closeAsync(),
  );
}

type BoundaryState = {
  error: Error | null;
  retrying: boolean;
};

class DatabaseBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null, retrying: false };

  private readonly retryGate = createStorageRetryGate();

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error, retrying: false };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('DatabaseBoundary caught', error, info.componentStack);
  }

  retry = () => {
    const error = this.state.error;
    if (!error || this.state.retrying || Platform.OS !== 'web') return;
    const failure = classifyStorageFailure(error);
    if (!failure.canRetry) return;
    const started = this.retryGate.request(() => {
      window.location.reload();
    });
    if (started) this.setState({ retrying: true });
  };

  render() {
    if (this.state.error) {
      const failure = classifyStorageFailure(this.state.error);
      const onRetry = failure.canRetry && Platform.OS === 'web' ? this.retry : undefined;
      return <StorageStartupScreen failure={failure} retrying={this.state.retrying} onRetry={onRetry} />;
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <View style={styles.root}>
        <StatusBar style="auto" />
        <DatabaseBoundary>
          <Suspense fallback={<StorageOpening />}>
            <SQLiteProvider databaseName={DATABASE_NAME} onInit={prepareDatabase} useSuspense>
              <Stack screenOptions={{ headerTitle: 'stome', headerStyle: { backgroundColor: '#f6f4ee' }, headerTintColor: '#292820' }}>
                <Stack.Screen name="index" options={{ headerShown: false }} />
                <Stack.Screen name="rooms/[id]" options={{ headerShown: false }} />
                <Stack.Screen name="recent" options={{ headerShown: false }} />
                <Stack.Screen name="rooms/[id]/review" options={{ headerShown: false }} />
              </Stack>
              <QuickCapture />
            </SQLiteProvider>
          </Suspense>
        </DatabaseBoundary>
      </View>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#ffffff',
    flex: 1,
  },
});
