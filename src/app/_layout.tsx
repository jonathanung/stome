import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Outfit_700Bold, Outfit_800ExtraBold, Outfit_900Black } from '@expo-google-fonts/outfit';
import { SQLiteProvider } from 'expo-sqlite';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Component, Suspense, type ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { ThemeProvider, useStoneTheme } from '../../design-theme/src/primitives';
import { QuickCapture } from '../features/capture/QuickCapture';
import { expoDriver } from '../db/expo-driver';
import { migrateDb } from '../db/migrate';
import { DATABASE_NAME } from '../db/schema';

type BoundaryState = {
  error: Error | null;
};

function Centered({ children }: { children: ReactNode }) {
  const theme = useStoneTheme();
  return (
    <View style={{ alignItems: 'center', flex: 1, gap: theme.space.md, justifyContent: 'center', padding: theme.space.section, backgroundColor: theme.color.bg.canvas }}>
      {children}
    </View>
  );
}

function DatabaseError({ error }: { error: Error }) {
  const theme = useStoneTheme();
  return (
    <Centered>
      <Text accessibilityRole="alert" style={[theme.text('title'), { color: theme.color.text.primary, textAlign: 'center' }]}>
        Could not open the local database.
      </Text>
      <Text style={[theme.text('bodySmall'), { color: theme.color.text.secondary, textAlign: 'center' }]}>{error.message}</Text>
    </Centered>
  );
}

class DatabaseBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) return <DatabaseError error={this.state.error} />;
    return this.props.children;
  }
}

function Opening() {
  const theme = useStoneTheme();
  return (
    <Centered>
      <ActivityIndicator color={theme.color.accent.bg} />
      <Text style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>Opening local notes…</Text>
    </Centered>
  );
}

function AppStack() {
  const theme = useStoneTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg.canvas }}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <DatabaseBoundary>
        <Suspense fallback={<Opening />}>
          <SQLiteProvider databaseName={DATABASE_NAME} onInit={(db) => migrateDb(expoDriver(db))} useSuspense>
            <Stack
              screenOptions={{
                headerTitle: 'stome',
                headerShadowVisible: false,
                headerStyle: { backgroundColor: theme.color.bg.canvas },
                headerTintColor: theme.color.text.primary,
                headerTitleStyle: { fontFamily: theme.text('actionTitle').fontFamily, fontSize: 17 },
                contentStyle: { backgroundColor: theme.color.bg.canvas },
              }}
            >
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="today" options={{ headerShown: false }} />
              <Stack.Screen name="rooms/[id]" options={{ headerShown: false }} />
              <Stack.Screen name="recent" options={{ headerShown: false }} />
              <Stack.Screen name="rooms/[id]/review" options={{ headerShown: false }} />
            </Stack>
            <QuickCapture />
          </SQLiteProvider>
        </Suspense>
      </DatabaseBoundary>
    </View>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Outfit_700Bold,
    Outfit_800ExtraBold,
    Outfit_900Black,
  });
  // A font that fails to load falls back to the system face rather than blocking the app.
  const ready = loaded || Boolean(error);
  return (
    <ThemeProvider fontMode={ready && !error ? 'expo' : 'css'}>
      {ready ? <AppStack /> : <Centered><ActivityIndicator /></Centered>}
    </ThemeProvider>
  );
}
