import { getRandomBytes } from 'expo-crypto';
import { Stack } from 'expo-router';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Component, Suspense, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { ThemeProvider, useStoneTheme } from '../../design-theme/src/primitives';
import { expoDriver } from '../db/expo-driver';
import { migrateDb } from '../db/migrate';
import { DATABASE_NAME } from '../db/schema';
import { classifyStorageFailure, createStorageRetryGate, finishStartup } from '../db/storage-startup';
import { QuickCapture } from '../features/capture/QuickCapture';
import { installHarnessRandomBytes } from '../harness/ids';
import { StorageOpening, StorageStartupScreen } from '../screens/StorageStartup';
import { stackHeaderOptions } from '../theme/stack-header';

installHarnessRandomBytes((size) => getRandomBytes(size));

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

function AppStack() {
  const theme = useStoneTheme();
  return (
    <Stack screenOptions={stackHeaderOptions(theme)}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="rooms/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="recent" options={{ headerShown: false }} />
      <Stack.Screen name="rooms/[id]/review" options={{ headerShown: false }} />
    </Stack>
  );
}

function ThemedRoot({ children }: { children: ReactNode }) {
  const theme = useStoneTheme();
  return <View style={[styles.root, { backgroundColor: theme.color.bg.canvas }]}>{children}</View>;
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ThemedRoot>
        <StatusBar style="auto" />
        <DatabaseBoundary>
          <Suspense fallback={<StorageOpening />}>
            <SQLiteProvider databaseName={DATABASE_NAME} onInit={prepareDatabase} useSuspense>
              <AppStack />
              <QuickCapture />
            </SQLiteProvider>
          </Suspense>
        </DatabaseBoundary>
      </ThemedRoot>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
