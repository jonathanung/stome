import { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Path, Rect, G } from 'react-native-svg';

import { Button, Card, Screen, TrilithonMark, useStoneTheme } from '../../design-theme/src/primitives';
import {
  AUTO_RETRY_DELAY_SECONDS,
  AUTO_RETRY_LIMIT,
  canAutoRetry,
  readAttempt,
  readFirstAttemptAt,
  recordRetry,
  type StorageFailure,
} from '../db/storage-startup';

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

function sessionStore() {
  if (Platform.OS !== 'web') return null;
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Asks any other stome tab to let go of the database. Best effort; absent where BroadcastChannel is. */
function requestTakeover() {
  try {
    if (Platform.OS !== 'web' || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('stome.storage');
    channel.postMessage({ type: 'takeover' });
    channel.close();
  } catch {
    // Nothing to tell: the retry that follows is the whole recovery.
  }
}

function copyText(text: string) {
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') void navigator.clipboard?.writeText(text);
  } catch {
    // The details are also selectable text.
  }
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function clockTime(at: number) {
  const date = new Date(at);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function StoneMark({ color, accent }: { color: string; accent: string }) {
  return (
    <Svg width={120} height={64} viewBox="0 0 120 64" aria-hidden>
      <Rect y={56} width={120} height={8} rx={3} fill="#a9ad8f" />
      <G fill={color}>
        <Rect x={22} y={22} width={14} height={34} rx={2} />
        <Rect x={58} y={22} width={14} height={34} rx={2} />
        <Rect x={18} y={12} width={58} height={10} rx={2} />
      </G>
      <Rect x={84} y={46} width={30} height={10} rx={2} fill={accent} transform="rotate(-6 99 51)" />
    </Svg>
  );
}

const BUSY_COPY = {
  eyebrow: "can't open your notes yet",
  title: 'stome is busy in another tab',
  body: 'your browser lets one tab hold the notes database at a time. nothing was written and nothing is lost.',
};

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
  const busy = failure.kind === 'busy';
  const showRetry = failure.canRetry && onRetry != null;
  const [attempt] = useState(() => readAttempt(sessionStore()));
  const [firstAt] = useState(() => readFirstAttemptAt(sessionStore()));
  const [copied, setCopied] = useState(false);
  const auto = busy && showRetry && canAutoRetry(failure, attempt);
  const [seconds, setSeconds] = useState(AUTO_RETRY_DELAY_SECONDS);
  const [opened, setOpened] = useState(false);

  const retryNow = () => {
    recordRetry(sessionStore());
    onRetry?.();
  };

  useEffect(() => {
    if (!auto || retrying) return;
    if (seconds <= 0) {
      recordRetry(sessionStore());
      onRetry?.();
      return;
    }
    const id = setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => clearTimeout(id);
  }, [auto, retrying, seconds, onRetry]);

  const takeOver = () => {
    requestTakeover();
    retryNow();
  };
  const isolated = typeof crossOriginIsolated === 'boolean' ? (crossOriginIsolated ? 'yes' : 'no') : 'unknown';
  const details = `${failure.diagnostic}\ncross-origin isolated: ${isolated}\nattempts: ${attempt} · first at ${clockTime(firstAt)}`;

  const secondary = { color: theme.color.text.secondary };
  const warning = theme.color.status.warning;
  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: theme.space.section }}
        >
          <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center' }}>
            <Card>
              <View style={{ gap: 20 }}>
                {busy ? (
                  <StoneMark color={theme.color.accent.bg} accent={warning.fill} />
                ) : (
                  <TrilithonMark width={40} height={28} />
                )}
                <View style={{ gap: theme.space.sm }}>
                  {busy ? (
                    <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>{BUSY_COPY.eyebrow}</Text>
                  ) : null}
                  <Text accessibilityRole="header" style={[theme.text('screenTitle'), { color: theme.color.text.primary }]}>
                    {busy ? BUSY_COPY.title : failure.title}
                  </Text>
                  <Text accessibilityRole="alert" style={[theme.text('body'), secondary]}>
                    {busy ? BUSY_COPY.body : failure.message}
                  </Text>
                </View>
                {auto ? (
                  <View
                    accessibilityRole="alert"
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingVertical: 12,
                      paddingHorizontal: 14,
                      borderRadius: theme.radius.lg,
                      backgroundColor: warning.wash,
                    }}
                  >
                    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={warning.text} strokeWidth={2} strokeLinecap="round">
                      <Path d="M21 12a9 9 0 1 1-3-6.7" />
                      <Path d="M21 4v5h-5" />
                    </Svg>
                    <Text style={[theme.text('bodySmall'), { flex: 1, color: warning.text }]}>
                      {retrying
                        ? 'trying again…'
                        : `trying again in ${seconds}s · attempt ${attempt} of ${AUTO_RETRY_LIMIT}`}
                    </Text>
                  </View>
                ) : null}
                {busy ? (
                  <View style={{ gap: 10 }}>
                    {['close other stome tabs or windows on this device', 'or open stome here and the other tab will pause'].map((step, index) => (
                      <View key={step} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                        <View
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 7,
                            backgroundColor: theme.color.bg.inset,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Text style={[theme.text('label'), { color: theme.color.text.primary }]}>{index + 1}</Text>
                        </View>
                        <Text style={[theme.text('body'), { flex: 1, color: theme.color.text.primary }]}>{step}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {showRetry ? (
                  <View style={{ flexDirection: 'row', gap: theme.space.sm, flexWrap: 'wrap' }}>
                    <Button
                      label={retrying ? 'Retrying…' : busy ? 'try again now' : 'Retry'}
                      disabled={retrying}
                      onPress={retryNow}
                    />
                    {busy ? <Button label="use this tab" variant="outline" disabled={retrying} onPress={takeOver} /> : null}
                  </View>
                ) : null}
                <View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: opened }}
                    onPress={() => setOpened((value) => !value)}
                    style={{ minHeight: 32, justifyContent: 'center' }}
                  >
                    <Text style={[theme.text('bodySmall'), secondary]}>
                      {opened ? '▾' : '▸'} details for a bug report
                    </Text>
                  </Pressable>
                  {opened ? (
                    <View
                      style={{
                        marginTop: theme.space.sm,
                        backgroundColor: theme.color.bg.canvas,
                        borderRadius: theme.radius.control,
                        padding: theme.space.xl,
                      }}
                    >
                      <Text
                        selectable
                        style={[
                          theme.text('bodySmall'),
                          { color: theme.color.text.secondary, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
                        ]}
                      >
                        {details}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          copyText(details);
                          setCopied(true);
                        }}
                        style={{ minHeight: 32, justifyContent: 'center' }}
                      >
                        <Text style={[theme.text('bodySmall'), secondary]}>{copied ? 'copied' : 'copy'}</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              </View>
            </Card>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}
