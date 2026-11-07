import type { SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { getNote, type Note } from '../db/notes';
import { companionProvider } from '../harness/companionClient';
import {
  MOCK_SCENARIOS,
  SCAFFOLD_ROOM_ID,
  noteToChunk,
  selectionFromNotes,
  type MockScenario,
  type StoredProposal,
} from '../harness/contract';
import { harnessExecutor } from '../harness/expoDb';
import {
  beginQuestion,
  confirmQuestion,
  discardQuestion,
  fulfillQuestion,
  type PreparedRun,
} from '../harness/runTurn';
import { cancelRun, latestSession, type HarnessSession } from '../harness/store';
type Activity = 'idle' | 'asking' | 'confirming' | 'discarding';

type HarnessPanelProps = {
  notes: readonly Note[];
  notesDb: SQLiteDatabase;
  selectedIds: readonly number[];
  database: SQLiteDatabase | null;
  databaseError: string | null;
  onSaved: () => void;
};

const DEFAULT_COMPANION_URL = 'http://127.0.0.1:8787';

export function HarnessPanel({ notes, notesDb, selectedIds, database, databaseError, onSaved }: HarnessPanelProps) {
  const [companionUrl, setCompanionUrl] = useState(DEFAULT_COMPANION_URL);
  const [token, setToken] = useState('');
  const [prompt, setPrompt] = useState('');
  const [scenario, setScenario] = useState<MockScenario>('success');
  const [session, setSession] = useState<HarnessSession | null>(null);
  const [proposal, setProposal] = useState<StoredProposal | null>(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivityState] = useState<Activity>('idle');
  const activityRef = useRef<Activity>('idle');
  const runRef = useRef<PreparedRun | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const operationRef = useRef<string | null>(null);

  function setActivity(next: Activity) {
    activityRef.current = next;
    setActivityState(next);
  }

  useEffect(() => {
    if (!database) {
      return;
    }
    let active = true;
    latestSession(harnessExecutor(database))
      .then((latest) => {
        if (!active || !latest) {
          return;
        }
        setSession(latest);
        setStatus(latest.state);
        if (latest.state === 'completed' && latest.proposal && !latest.confirmedOperationId) {
          setProposal(latest.proposal);
          operationRef.current = globalThis.crypto.randomUUID();
        }
        if (latest.errorMessage && (latest.state === 'failed' || latest.state === 'cancelled')) {
          setError(latest.errorMessage);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Could not read the harness session');
        }
      });
    return () => {
      active = false;
    };
  }, [database]);

  async function onAsk(continueSession: boolean) {
    if (!database) {
      setError(databaseError ?? 'The harness database is not open');
      return;
    }
    if (token.trim().length === 0) {
      setError('Paste the pairing token from the companion. It stays in memory only.');
      return;
    }
    if (activityRef.current !== 'idle') {
      return;
    }
    setActivity('asking');
    setError(null);
    setProposal(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const pool = notes.map(noteToChunk);
      const chunks = continueSession ? pool : selectionFromNotes(notes, selectedIds);
      const prepared = await beginQuestion(harnessExecutor(database), {
        chunks,
        prompt,
        continueSessionId: continueSession ? session?.id : null,
      });
      runRef.current = prepared;
      setStatus('running');
      const outcome = await fulfillQuestion(harnessExecutor(database), prepared, {
        chunks: pool,
        scenario,
        provider: companionProvider({ baseUrl: companionUrl.trim(), token: token.trim() }),
        signal: controller.signal,
      });
      setSession(outcome.session);
      setStatus(outcome.session?.state ?? outcome.status);
      if (outcome.status === 'proposal' && outcome.proposal && outcome.session?.state === 'completed') {
        setProposal(outcome.proposal);
        operationRef.current = globalThis.crypto.randomUUID();
        setError(null);
      } else {
        setProposal(null);
        setError(outcome.errorMessage);
      }
    } catch (caught: unknown) {
      setStatus('failed');
      setError(caught instanceof Error ? caught.message : 'Could not ask the companion');
    } finally {
      setActivity('idle');
      abortRef.current = null;
    }
  }

  async function onCancel() {
    const prepared = runRef.current;
    abortRef.current?.abort();
    if (!database || !prepared) {
      setStatus('cancelled');
      return;
    }
    await cancelRun(harnessExecutor(database), {
      sessionId: prepared.sessionId,
      runToken: prepared.runToken,
      now: Date.now(),
    });
    setProposal(null);
    setStatus('cancelled');
    setError('You cancelled this question. Saved notes were not changed.');
  }

  async function onConfirm() {
    if (!database || !session || !proposal || activityRef.current !== 'idle') {
      return;
    }
    const operationId = operationRef.current ?? globalThis.crypto.randomUUID();
    operationRef.current = operationId;
    setActivity('confirming');
    setError(null);
    try {
      const note = await getNote(notesDb, proposal.noteId);
      if (!note) {
        setError('The note for this proposal is not open');
        return;
      }
      await confirmQuestion(harnessExecutor(database), {
        sessionId: session.id,
        note,
        operationId,
        confirmed: true,
      });
      setProposal(null);
      setStatus('completed');
      setError(null);
      onSaved();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Could not save the answer');
    } finally {
      setActivity('idle');
    }
  }

  async function onDiscard() {
    if (!database || !session || activityRef.current !== 'idle') {
      return;
    }
    setActivity('discarding');
    try {
      await discardQuestion(harnessExecutor(database), session.id);
      setProposal(null);
      setStatus('completed');
      setError('Discarded the proposal. Saved notes were not changed.');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Could not discard the proposal');
    } finally {
      setActivity('idle');
    }
  }

  const pending = proposal !== null;
  const busy = activity !== 'idle';
  const askDisabled = busy || !database || selectedIds.length === 0 || prompt.trim().length === 0 || pending;
  const continueDisabled =
    busy || !database || !session || pending || (session.state !== 'failed' && session.state !== 'cancelled' && session.state !== 'completed');
  const confirmDisabled = busy;
  const discardDisabled = busy;

  return (
    <View style={styles.box} testID="harness-panel">
      <Text style={styles.heading}>Ask about selected notes</Text>
      <Text style={styles.runtime} testID="harness-runtime">
        {`expo-sqlite · room ${SCAFFOLD_ROOM_ID} · notes in stome.db · sessions and stub answers in stome-harness.db`}
      </Text>
      <Text style={styles.help}>
        Tick notes below. The companion is a local mock. Paste its pairing token here; it is not saved in browser storage.
      </Text>
      <Text style={styles.label}>Companion</Text>
      <TextInput
        accessibilityLabel="Companion URL"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setCompanionUrl}
        style={styles.input}
        testID="companion-url"
        value={companionUrl}
      />
      <Text style={styles.label}>Pairing token</Text>
      <TextInput
        accessibilityLabel="Pairing token"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setToken}
        style={styles.input}
        testID="pairing-token"
        value={token}
      />
      <Text style={styles.label}>Question</Text>
      <TextInput
        accessibilityLabel="Question"
        onChangeText={setPrompt}
        style={styles.input}
        testID="ask-input"
        value={prompt}
      />
      <View style={styles.scenarios}>
        {MOCK_SCENARIOS.map((item) => {
          const selected = item === scenario;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={item}
              onPress={() => setScenario(item)}
              style={[styles.scenario, selected ? styles.scenarioSelected : null]}
              testID={`scenario-${item}`}
            >
              <Text style={selected ? styles.scenarioTextSelected : styles.scenarioText}>{item}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text testID="harness-state">{`Session: ${status}`}</Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: askDisabled }}
          disabled={askDisabled}
          onPress={() => {
            void onAsk(false);
          }}
          style={[styles.button, askDisabled ? styles.buttonDisabled : null]}
          testID="ask-button"
        >
          <Text style={styles.buttonText}>{busy ? 'Working…' : 'Ask'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: activity !== 'asking' }}
          disabled={activity !== 'asking'}
          onPress={() => {
            void onCancel();
          }}
          style={[styles.secondary, activity !== 'asking' ? styles.buttonDisabled : null]}
          testID="cancel-button"
        >
          <Text style={styles.secondaryText}>Cancel</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: continueDisabled }}
          disabled={continueDisabled}
          onPress={() => {
            void onAsk(true);
          }}
          style={[styles.secondary, continueDisabled ? styles.buttonDisabled : null]}
          testID="continue-button"
        >
          <Text style={styles.secondaryText}>Continue</Text>
        </Pressable>
      </View>
      {proposal ? (
        <View style={styles.proposal} testID="proposal-card">
          <Text style={styles.proposalTitle}>Proposed AI answer</Text>
          <Text testID="proposal-body">{proposal.body}</Text>
          <Text style={styles.help}>{`Anchored to note ${proposal.noteId}, revision ${proposal.chunkRevision}. Nothing is saved until you confirm.`}</Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: confirmDisabled }}
              disabled={confirmDisabled}
              onPress={() => {
                void onConfirm();
              }}
              style={[styles.button, confirmDisabled ? styles.buttonDisabled : null]}
              testID="confirm-button"
            >
              <Text style={styles.buttonText}>Confirm and save</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: discardDisabled }}
              disabled={discardDisabled}
              onPress={() => {
                void onDiscard();
              }}
              style={[styles.secondary, discardDisabled ? styles.buttonDisabled : null]}
              testID="discard-button"
            >
              <Text style={styles.secondaryText}>Discard</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error} testID="harness-error">
          {error}
        </Text>
      ) : null}
      {databaseError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {databaseError}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderColor: '#cccccc',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 16,
    padding: 12,
  },
  heading: {
    color: '#111111',
    fontSize: 18,
    fontWeight: '600',
  },
  runtime: {
    color: '#555555',
    fontSize: 12,
    marginTop: 4,
  },
  help: {
    color: '#555555',
    fontSize: 13,
    marginTop: 6,
  },
  label: {
    color: '#333333',
    fontSize: 13,
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderColor: '#cccccc',
    borderRadius: 8,
    borderWidth: 1,
    color: '#111111',
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  scenarios: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  scenario: {
    borderColor: '#cccccc',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  scenarioSelected: {
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  scenarioText: {
    color: '#111111',
    fontSize: 13,
  },
  scenarioTextSelected: {
    color: '#ffffff',
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  button: {
    backgroundColor: '#111111',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondary: {
    borderColor: '#111111',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  secondaryText: {
    color: '#111111',
    fontSize: 16,
  },
  proposal: {
    backgroundColor: '#f6f6f6',
    borderRadius: 8,
    marginTop: 12,
    padding: 12,
  },
  proposalTitle: {
    color: '#111111',
    fontWeight: '600',
    marginBottom: 4,
  },
  error: {
    color: '#8a1f1f',
    marginTop: 8,
  },
});
