import { SafeAreaView } from 'react-native-safe-area-context';
import { ActivityIndicator, Text, View } from 'react-native';

import { Button, Card, Screen, TrilithonMark, useStoneTheme } from '../../design-theme/src/primitives';
import type { StorageFailure } from '../db/storage-startup';

export function StorageOpening() {
  const theme = useStoneTheme();
  return (
    <Screen>
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.space.md }}>
        <ActivityIndicator color={theme.color.text.primary} />
        <Text style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>Opening local notes…</Text>
      </SafeAreaView>
    </Screen>
  );
}

export function StorageStartupScreen({
  failure,
  retrying,
  onRetry,
}: {
  failure: StorageFailure;
  retrying: boolean;
  onRetry?: () => void;
}) {
  const theme = useStoneTheme();
  const showRetry = failure.canRetry && onRetry != null;
  return (
    <Screen>
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: theme.space.section }}>
        <View style={{ width: '100%', maxWidth: 480, alignSelf: 'center' }}>
          <Card>
            <View style={{ gap: theme.space.base }}>
              <TrilithonMark width={40} height={28} />
              <Text
                accessibilityRole="header"
                style={[theme.text('screenTitle'), { color: theme.color.text.primary }]}
              >
                {failure.title}
              </Text>
              <Text accessibilityRole="alert" style={[theme.text('body'), { color: theme.color.text.secondary }]}>
                {failure.message}
              </Text>
              {showRetry ? (
                <Button label={retrying ? 'Retrying…' : 'Retry'} disabled={retrying} onPress={onRetry} />
              ) : null}
              <View
                style={{
                  gap: theme.space.sm,
                  backgroundColor: theme.color.bg.inset,
                  borderRadius: theme.radius.control,
                  padding: theme.space.xl,
                }}
              >
                <Text style={[theme.text('label'), { color: theme.color.text.secondary }]}>Error details</Text>
                <Text selectable style={[theme.text('bodySmall'), { color: theme.color.text.primary }]}>
                  {failure.diagnostic}
                </Text>
              </View>
            </View>
          </Card>
        </View>
      </SafeAreaView>
    </Screen>
  );
}
