import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, Card, Screen, useStoneTheme } from '../../design-theme/src/primitives';
import { listRooms } from '../data/queries';
import { expoDriver } from '../db/expo-driver';
import { companionSetup, readCompanionContext } from '../harness/companionAddress';
import { DEFAULT_COMPANION_URL, PROVIDER_NAMES, companionLabel, isLiveCompanion, refreshCompanionStatus, updateCompanionSettings, useCompanionSettings } from '../harness/companionSettings';
import { MOCK_SCENARIOS, PROVIDER_LIMITS, type SessionState } from '../harness/contract';
import { harnessExecutor, openHarnessDatabase } from '../harness/expoDb';
import { listSessionSummaries, type HarnessSessionSummary } from '../harness/store';
import { BackButton, Notice, SectionTitle } from '../ui/kit';

type Connection = 'unpaired' | 'testing' | 'paired' | 'rejected';

const WIDE = 960;

/** Companion settings: pairing, model, and the saved sessions list (#48, #49, #50). */
export function CompanionScreen() {
  const theme = useStoneTheme();
  const sqlite = useSQLiteContext();
  const appDb = useMemo(() => expoDriver(sqlite), [sqlite]);
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const settings = useCompanionSettings();
  const [connection, setConnection] = useState<Connection>('unpaired');
  const [message, setMessage] = useState<string | null>(null);
  const [sessions, setSessions] = useState<HarnessSessionSummary[]>([]);
  const [roomNames, setRoomNames] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const harness = await openHarnessDatabase();
          const [rows, rooms] = await Promise.all([listSessionSummaries(harnessExecutor(harness)), listRooms(appDb)]);
          if (!active) return;
          setSessions(rows);
          setRoomNames(Object.fromEntries(rooms.map((room) => [room.id, room.name])));
        } catch (reason: unknown) {
          if (active) setLoadError(reason instanceof Error ? reason.message : 'Could not read saved sessions');
        }
      })();
      return () => {
        active = false;
      };
    }, [appDb]),
  );

  async function testConnection() {
    if (!settings.token.trim()) {
      setConnection('unpaired');
      setMessage('Paste the token the companion printed first.');
      return;
    }
    setConnection('testing');
    setMessage(null);
    const failure = await refreshCompanionStatus();
    if (failure) {
      setConnection('rejected');
      setMessage(failure);
    } else {
      setConnection('paired');
    }
  }

  function unpair() {
    updateCompanionSettings({ token: '' });
    setConnection('unpaired');
    setMessage(null);
  }

  const eyebrow = [theme.text('eyebrow'), { color: theme.color.text.tertiary, textTransform: 'uppercase' as const }];
  const meta = [theme.text('bodySmall'), { color: theme.color.text.tertiary }];
  const input = {
    ...theme.text('bodySmall'),
    minHeight: theme.layout.control,
    borderRadius: theme.radius.control,
    borderWidth: 1,
    borderColor: theme.color.border.strong,
    backgroundColor: theme.color.bg.canvas,
    color: theme.color.text.primary,
    paddingHorizontal: 12,
  };

  const live = isLiveCompanion(settings);
  const statusLabel = companionLabel(settings.status);
  const setup = companionSetup(readCompanionContext());

  const pairing = (
    <Card>
      <View style={{ gap: theme.space.xl }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text accessibilityRole="header" style={[theme.text('title'), { color: theme.color.text.primary }]}>Pairing</Text>
          {connection === 'paired' ? <Badge tone="success" label="paired" /> : null}
          {connection === 'rejected' ? <Badge tone="danger" label="not paired" /> : null}
        </View>
        <View testID="companion-setup" style={{ gap: 2 }}>
          {setup.steps.map((step, index) => (
            <Text key={step} style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>{`${index + 1}. ${step}`}</Text>
          ))}
        </View>
        <Text testID="companion-address-hint" style={meta}>{setup.addressHint}</Text>
        <View style={{ gap: 6 }}>
          <Text style={eyebrow}>Companion address</Text>
          <TextInput accessibilityLabel="Companion address" autoCapitalize="none" autoCorrect={false} keyboardType="url"
            value={settings.url} onChangeText={(url) => updateCompanionSettings({ url })} placeholder={DEFAULT_COMPANION_URL}
            placeholderTextColor={theme.color.text.disabled} style={input} testID="companion-address" />
        </View>
        <View style={{ gap: 6 }}>
          <Text style={eyebrow}>Pairing token</Text>
          <TextInput accessibilityLabel="Pairing token" autoCapitalize="none" autoCorrect={false} secureTextEntry
            value={settings.token} onChangeText={(token) => { updateCompanionSettings({ token }); setConnection('unpaired'); }}
            placeholderTextColor={theme.color.text.disabled} style={input} testID="companion-token" />
        </View>
        <Text style={meta}>The token lives in memory only. Reload the app and you&apos;ll paste it again.</Text>
        {message ? <Notice testID="companion-connection-message" tone={connection === 'rejected' ? 'danger' : 'neutral'}>{message}</Notice> : null}
        <View style={{ flexDirection: 'row', gap: theme.space.md }}>
          <Button label={connection === 'testing' ? 'Testing…' : 'Test connection'} disabled={connection === 'testing'} onPress={() => void testConnection()} />
          <Button label="Unpair" variant="outline" disabled={!settings.token} onPress={unpair} />
        </View>
      </View>
    </Card>
  );

  const model = (
    <Card>
      <View style={{ gap: theme.space.xl }}>
        <Text accessibilityRole="header" style={[theme.text('title'), { color: theme.color.text.primary }]}>Model</Text>
        <View accessibilityRole="radio" accessibilityState={{ selected: true }}
          style={{ flexDirection: 'row', gap: 10, padding: 11, borderRadius: theme.radius.control, borderWidth: 2, borderColor: theme.color.text.primary, backgroundColor: theme.color.bg.canvas }}>
          <Radio on />
          <View style={{ flex: 1, gap: 6 }}>
            <Text testID="companion-model-label" style={[theme.text('bodySmall'), { color: theme.color.text.primary, fontWeight: '600' }]}>
              {statusLabel ?? 'Not checked yet'}
            </Text>
            {live ? (
              <Text style={meta}>{`Live questions go to ${settings.status ? PROVIDER_NAMES[settings.status.provider] : 'the provider'} from the companion and cost money.`} The API key never leaves the companion.</Text>
            ) : (
              <>
                <Text style={meta}>{statusLabel ? 'Deterministic, for building and demos. Pick what it does:' : 'Test the connection to see which model answers. Until then the mock scenarios apply:'}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {MOCK_SCENARIOS.map((name) => {
                    const on = name === settings.scenario;
                    return (
                      <Text key={name} accessibilityRole="button" accessibilityState={{ selected: on }} testID={`companion-scenario-${name}`}
                        onPress={() => updateCompanionSettings({ scenario: name })}
                        style={[theme.text('label'), {
                          paddingVertical: 10, paddingHorizontal: 14, borderRadius: theme.radius.pill, overflow: 'hidden',
                          backgroundColor: on ? theme.color.accent.bg : theme.color.bg.inset,
                          color: on ? theme.color.accent.fg : theme.color.text.secondary,
                        }]}>
                        {name}
                      </Text>
                    );
                  })}
                </View>
              </>
            )}
          </View>
        </View>
        <Option title="API key" body="Set the key in the companion's environment. It is never stored in the app." />
        <Option title="Sign in with a subscription" body="Codex or Grok sign-in, still being researched" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 8 }}>
          <LimitField label="timeout" unit="s" testID="companion-limit-timeout" value={settings.limits.timeoutSec}
            onChange={(timeoutSec) => updateCompanionSettings({ limits: { ...settings.limits, timeoutSec } })} />
          <LimitField label="max" unit="chunks per question" testID="companion-limit-chunks" value={settings.limits.maxChunks}
            onChange={(maxChunks) => updateCompanionSettings({ limits: { ...settings.limits, maxChunks } })} />
          <LimitField label="max answer" unit="characters" testID="companion-limit-answer" value={settings.limits.maxAnswerChars}
            onChange={(maxAnswerChars) => updateCompanionSettings({ limits: { ...settings.limits, maxAnswerChars } })} />
        </View>
        <Text style={meta}>Limits are placeholders until the harness documents them. Today it uses {PROVIDER_LIMITS.timeoutMs / 1000} s and {PROVIDER_LIMITS.maxOutputChars.toLocaleString()} characters.</Text>
      </View>
    </Card>
  );

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={{ width: '100%', maxWidth: theme.layout.mainMax, alignSelf: 'center', padding: wide ? 40 : theme.space.card, paddingBottom: 120, gap: theme.space.section }}>
          <View style={{ gap: 6 }}>
            <BackButton label="Settings" accessibilityLabel="Back to settings" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
            <Text accessibilityRole="header" style={[theme.text('screenTitle'), { color: theme.color.text.primary }]}>AI companion</Text>
            <Text style={[theme.text('body'), { color: theme.color.text.secondary }]}>
              AI runs in a small program on your laptop, not in this app. It only sees the chunks you tick, and every change waits for you to confirm.
            </Text>
          </View>
          <View style={{ flexDirection: wide ? 'row' : 'column', gap: 20, alignItems: 'stretch' }}>
            <View style={{ flex: wide ? 1 : undefined }}>{pairing}</View>
            <View style={{ flex: wide ? 1 : undefined }}>{model}</View>
          </View>
          <Card>
            <View style={{ gap: theme.space.xl }}>
              <SectionTitle aside={<Text style={meta}>Saved on this device · a session stays in one room</Text>}>Sessions</SectionTitle>
              {loadError ? <Notice tone="danger">{loadError}</Notice> : null}
              {sessions.length === 0 && !loadError ? <Text style={meta}>No questions yet. Tick chunks in a room and ask.</Text> : null}
              {wide && sessions.length > 0 ? <SessionHeader /> : null}
              {sessions.map((session) => (
                <SessionRow key={session.id} session={session} room={roomNames[session.roomId] ?? 'Unknown room'} wide={wide} />
              ))}
              <Text style={meta}>If the app closes mid-answer, that session shows as failed next time. Continue picks up from the saved messages.</Text>
            </View>
          </Card>
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

function LimitField({ label, unit, value, onChange, testID }: { label: string; unit: string; value: string; onChange: (value: string) => void; testID: string }) {
  const theme = useStoneTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>{label}</Text>
      <TextInput accessibilityLabel={`${label} ${unit}`} keyboardType="number-pad" value={value} onChangeText={(text) => onChange(text.replace(/[^0-9]/g, ''))} testID={testID}
        style={[theme.text('bodySmall'), { minWidth: 52, textAlign: 'center', paddingVertical: 4, paddingHorizontal: 8, borderRadius: theme.radius.control, borderWidth: 1, borderColor: theme.color.border.strong, backgroundColor: theme.color.bg.canvas, color: theme.color.text.primary }]} />
      <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>{unit}</Text>
    </View>
  );
}

function SessionHeader() {
  const theme = useStoneTheme();
  const head = [theme.text('eyebrow'), { color: theme.color.text.tertiary, textTransform: 'uppercase' as const }];
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      <Text style={[head, { flex: 3 }]}>Question</Text>
      <Text style={[head, { flex: 2 }]}>Room</Text>
      <Text style={[head, { flex: 2 }]}>Scope</Text>
      <Text style={[head, { flex: 2 }]}>State</Text>
      <Text style={[head, { flex: 3 }]}>Result</Text>
      <View style={{ flex: 1 }} />
    </View>
  );
}

function Radio({ on }: { on?: boolean }) {
  const theme = useStoneTheme();
  return <View style={{ width: 18, height: 18, borderRadius: 9, marginTop: 1, borderColor: on ? theme.color.accent.bg : theme.color.border.strong, borderWidth: on ? 5 : 1.5 }} />;
}

function Option({ title, body }: { title: string; body: string }) {
  const theme = useStoneTheme();
  return (
    <View accessibilityState={{ disabled: true }} style={{ opacity: 0.6, flexDirection: 'row', gap: 10, padding: 12, borderRadius: theme.radius.control, borderWidth: 1, borderColor: theme.color.border.hairline, backgroundColor: theme.color.bg.canvas }}>
      <Radio />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[theme.text('bodySmall'), { color: theme.color.text.primary, fontWeight: '600' }]}>{title}</Text>
        <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>{body}</Text>
      </View>
    </View>
  );
}

function resultText(session: HarnessSessionSummary): string {
  if (session.state === 'completed') return session.hasPinnedAnswer ? (session.isEdit ? 'edit saved' : 'answer pinned') : 'waiting for you to confirm';
  if (session.state === 'running') return 'waiting for model';
  if (session.state === 'cancelled') return 'late answer discarded';
  if (session.state === 'failed') return session.errorCode === 'timeout' ? 'timed out, nothing changed' : session.errorCode === 'interrupted' ? 'interrupted, nothing changed' : 'nothing changed';
  return '';
}

function StateBadge({ state }: { state: SessionState }) {
  const theme = useStoneTheme();
  if (state === 'completed') return <Badge tone="success" label="completed" />;
  if (state === 'failed') return <Badge tone="danger" label="failed" />;
  if (state === 'cancelled') return <Badge tone="warning" label="cancelled" />;
  return (
    <View style={{ alignSelf: 'flex-start', paddingVertical: 2, paddingHorizontal: 10, borderRadius: theme.radius.pill, backgroundColor: theme.color.bg.inset }}>
      <Text style={[theme.text('label'), { color: theme.color.text.secondary }]}>{state}</Text>
    </View>
  );
}

function SessionRow({ session, room, wide }: { session: HarnessSessionSummary; room: string; wide: boolean }) {
  const theme = useStoneTheme();
  const scope = `${session.chunkCount} chunk${session.chunkCount === 1 ? '' : 's'}${session.isEdit ? ' · edit' : ''}`;
  const canContinue = session.state === 'failed' || session.state === 'cancelled';
  const running = session.state === 'running';
  const action = (
    <Button size="compact" variant="outline" label={running ? 'Cancel' : canContinue ? 'Continue' : 'Open'}
      onPress={() => router.push(`/rooms/${session.roomId}`)} />
  );
  const muted = { color: theme.color.text.tertiary };
  return (
    <View testID={`companion-session-${session.id}`} style={{ borderTopWidth: 1, borderTopColor: theme.color.border.hairline, paddingTop: 11, gap: 6, flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'flex-start' }}>
      <Text numberOfLines={2} style={[theme.text('bodySmall'), { flex: wide ? 3 : undefined, color: theme.color.text.primary }]}>{session.question || 'Untitled question'}</Text>
      <Text style={[theme.text('bodySmall'), { flex: wide ? 2 : undefined }, muted]}>{room}</Text>
      <Text style={[theme.text('bodySmall'), { flex: wide ? 2 : undefined }, muted]}>{scope}</Text>
      <View style={{ flex: wide ? 2 : undefined }}><StateBadge state={session.state} /></View>
      <Text style={[theme.text('bodySmall'), { flex: wide ? 3 : undefined }, muted]}>{resultText(session)}</Text>
      <View style={{ flex: wide ? 1 : undefined, alignItems: wide ? 'flex-end' : 'flex-start' }}>{action}</View>
    </View>
  );
}
