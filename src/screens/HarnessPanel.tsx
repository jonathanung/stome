import type { SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { createStyles } from '../../design-theme/src/primitives';

import { expoDriver } from '../db/expo-driver';
import { companionProvider } from '../harness/companionClient';
import { updateCompanionSettings, useCompanionSettings } from '../harness/companionSettings';
import {
  MOCK_SCENARIOS,
  chunkViewFromFoundation,
  isEditProposal,
  type MockScenario,
  type StoredProposal,
} from '../harness/contract';
import { harnessExecutor, openHarnessDatabase } from '../harness/expoDb';
import { AskProposalCard } from '../features/ask/AskProposalCard';
import { AskScopeBar } from '../features/ask/AskScopeBar';
import { AskSessionHeader } from '../features/ask/AskSessionHeader';
import { AskSheetPhone } from '../features/ask/AskSheetPhone';
import { AskTimeoutNotice } from '../features/ask/AskTimeoutNotice';
import { EditProposalReview, StaleEditNotice } from '../features/ask/EditProposalReview';
import { chunkLabel, citationsForProposal, visiblePinError, type ChunkFocus } from '../features/ask/citations';
import { harnessColors } from '../features/ask/harnessColors';
import {
  beginQuestion,
  confirmFoundationQuestion,
  discardQuestion,
  fulfillQuestion,
  type NotePurpose,
  type PreparedRun,
} from '../harness/runTurn';
import { cancelRun, ensurePendingOperationId, latestSession, type HarnessSession } from '../harness/store';

type ChunkTarget = {
  id: string;
  roomId: string;
  body: string;
  revision: number;
};

type HarnessPanelProps = {
  roomId: string;
  chunks: readonly ChunkTarget[];
  appDb: SQLiteDatabase;
  onSaved: () => void;
  onOpenCitation: (focus: ChunkFocus) => void;
};

type Activity = 'idle' | 'asking' | 'confirming' | 'discarding';

const PHONE_MAX_WIDTH = 600;

export function HarnessPanel({ roomId, chunks, appDb, onSaved, onOpenCitation }: HarnessPanelProps) {
  const styles = useStyles();
  const isPhone = useWindowDimensions().width < PHONE_MAX_WIDTH;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [askedPrompt, setAskedPrompt] = useState<string | null>(null);
  const [database, setDatabase] = useState<SQLiteDatabase | null>(null);
  const [databaseError, setDatabaseError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { url: companionUrl, token, scenario } = useCompanionSettings();
  const setCompanionUrl = (url: string) => updateCompanionSettings({ url });
  const setToken = (next: string) => updateCompanionSettings({ token: next });
  const setScenario = (next: MockScenario) => updateCompanionSettings({ scenario: next });
  const [prompt, setPrompt] = useState('');
  const [purpose, setPurpose] = useState<NotePurpose>('answer');
  const [session, setSession] = useState<HarnessSession | null>(null);
  const [proposal, setProposal] = useState<StoredProposal | null>(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivityState] = useState<Activity>('idle');
  const activityRef = useRef<Activity>('idle');
  const runRef = useRef<PreparedRun | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const askGeneration = useRef(0);

  function setActivity(next: Activity) {
    activityRef.current = next;
    setActivityState(next);
  }

  useEffect(() => {
    let active = true;
    openHarnessDatabase()
      .then((opened) => {
        if (active) {
          setDatabase(opened);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setDatabaseError(caught instanceof Error ? caught.message : 'Could not open the harness database');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!database) {
      return;
    }
    let active = true;
    latestSession(harnessExecutor(database))
      .then(async (latest) => {
        if (!active || !latest || latest.roomId !== roomId) {
          return;
        }
        const ready =
          latest.state === 'completed' && latest.proposal && !latest.confirmedOperationId && !latest.pendingOperationId
            ? await ensurePendingOperationId(harnessExecutor(database), latest.id, Date.now())
            : latest;
        if (!active) {
          return;
        }
        setSession(ready);
        setStatus(ready.state);
        if (ready.state === 'completed' && ready.proposal && !ready.confirmedOperationId) {
          setProposal(ready.proposal);
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
  }, [database, roomId]);

  function viewsFor(ids: readonly string[]) {
    const wanted = new Set(ids);
    return chunks.filter((chunk) => wanted.has(chunk.id)).map(chunkViewFromFoundation);
  }

  async function onAsk(continueSession: boolean, promptOverride?: string) {
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
    const generation = ++askGeneration.current;
    setActivity('asking');
    setError(null);
    setProposal(null);
    setAskedPrompt((promptOverride ?? prompt).trim());
    if (isPhone) setSheetOpen(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const pool = chunks.map(chunkViewFromFoundation);
      const selected = continueSession ? pool : viewsFor(selectedIds);
      const prepared = await beginQuestion(harnessExecutor(database), {
        chunks: selected,
        prompt: promptOverride ?? prompt,
        continueSessionId: continueSession ? session?.id : null,
      });
      runRef.current = prepared;
      setStatus('running');
      const outcome = await fulfillQuestion(harnessExecutor(database), prepared, {
        chunks: pool,
        scenario,
        purpose,
        provider: companionProvider({ baseUrl: companionUrl.trim(), token: token.trim() }),
        signal: controller.signal,
      });
      if (generation !== askGeneration.current) return;
      setSession(outcome.session);
      setStatus(outcome.session?.state ?? outcome.status);
      if (outcome.status === 'proposal' && outcome.proposal && outcome.session?.state === 'completed') {
        setProposal(outcome.proposal);
        setError(null);
      } else {
        setProposal(null);
        setError(outcome.errorMessage);
      }
    } catch (caught: unknown) {
      if (generation !== askGeneration.current) return;
      setStatus('failed');
      setError(caught instanceof Error ? caught.message : 'Could not ask the companion');
    } finally {
      if (generation === askGeneration.current) {
        setActivity('idle');
        abortRef.current = null;
      }
    }
  }

  async function onCancel() {
    const generation = ++askGeneration.current;
    const prepared = runRef.current;
    abortRef.current?.abort();
    setActivity('idle');
    setProposal(null);
    setStatus('cancelled');
    setError('You cancelled this question. Saved chunks were not changed.');
    if (!database || !prepared) return;
    await cancelRun(harnessExecutor(database), {
      sessionId: prepared.sessionId,
      runToken: prepared.runToken,
      now: Date.now(),
    });
    if (askGeneration.current !== generation) return;
    setProposal(null);
    setStatus('cancelled');
    setError('You cancelled this question. Saved chunks were not changed.');
  }

  async function onConfirm() {
    if (!database || !session?.pendingOperationId || !proposal || activityRef.current !== 'idle') {
      return;
    }
    setActivity('confirming');
    setError(null);
    try {
      await confirmFoundationQuestion(harnessExecutor(database), expoDriver(appDb), {
        sessionId: session.id,
        operationId: session.pendingOperationId,
        confirmed: true,
      });
      setProposal(null);
      setStatus('completed');
      setError(null);
      onSaved();
    } catch (caught: unknown) {
      setError(visiblePinError(caught));
      onSaved();
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
      setError(proposal && isEditProposal(proposal) ? 'Discarded the proposal. Saved chunks were not changed.' : 'Declined. Nothing was written.');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Could not discard the proposal');
    } finally {
      setActivity('idle');
    }
  }

  const pending = proposal !== null;
  const busy = activity !== 'idle';
  const editNeedsOne = purpose === 'edit' && selectedIds.length !== 1;
  const askDisabled = busy || !database || selectedIds.length === 0 || editNeedsOne || prompt.trim().length === 0 || pending;
  const continueDisabled =
    busy || !database || !session || pending || (session.state !== 'failed' && session.state !== 'cancelled' && session.state !== 'completed');
  const confirmDisabled = busy || !session?.pendingOperationId;

  const sheetCitations =
    proposal && !isEditProposal(proposal)
      ? citationsForProposal(session?.selectedChunkIds ?? [], chunks, proposal)
      : null;
  const includedLabels = (session?.selectedChunkIds?.length ? session.selectedChunkIds : selectedIds)
    .map((id) => chunks.find((chunk) => chunk.id === id))
    .filter((chunk): chunk is ChunkTarget => chunk !== undefined)
    .map((chunk) => chunkLabel(chunk.body));

  return (
    <View style={styles.box} testID="harness-panel">
      {isPhone ? (
        <AskSheetPhone
          busy={busy}
          canConfirm={!confirmDisabled}
          error={error}
          included={includedLabels}
          onAdd={() => setSheetOpen(false)}
          onClose={() => setSheetOpen(false)}
          onConfirm={() => {
            void onConfirm();
          }}
          onDecline={() => {
            void onDiscard();
          }}
          onFollowUp={(text) => {
            void onAsk(true, text);
          }}
          onOpenSource={onOpenCitation}
          problems={sheetCitations?.problems.map((problem) => problem.message) ?? []}
          proposal={
            proposal
              ? isEditProposal(proposal)
                ? { kind: 'edit', body: proposal.body, previousBody: proposal.previousBody }
                : { kind: 'answer', body: proposal.body }
              : null
          }
          question={askedPrompt}
          sources={(sheetCitations?.citations ?? []).map((citation) => ({
            chunkId: citation.chunkId,
            label: citation.label,
            quote: citation.anchored ? citation.quote : null,
            anchorStart: citation.anchorStart,
            anchorEnd: citation.anchorEnd,
          }))}
          visible={sheetOpen}
        />
      ) : null}
      <Text style={styles.heading}>Ask about selected chunks</Text>
      <AskScopeBar
        disabled={busy}
        included={selectedIds.length}
        onIncludeAll={() => setSelectedIds(chunks.map((chunk) => chunk.id))}
        total={chunks.length}
      />
      {askedPrompt ? (
        <AskSessionHeader
          chunkCount={session?.selectedChunkIds?.length ?? selectedIds.length}
          completed={session?.state === 'completed'}
          roomName="this room"
          title={askedPrompt.length > 40 ? `${askedPrompt.slice(0, 40)}…` : askedPrompt}
        />
      ) : null}
      {isPhone && (proposal || askedPrompt) && !sheetOpen ? (
        <Pressable accessibilityRole="button" onPress={() => setSheetOpen(true)} style={styles.secondary} testID="open-ask-sheet">
          <Text style={styles.secondaryText}>{proposal ? 'Review proposed answer' : 'Open ask'}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.runtime} testID="harness-runtime">
        Mock companion. A confirmed answer is saved on the chunk. An edit replaces one whole note and stays marked AI. Older demo pins stay in the harness file and are not copied.
      </Text>
      <Text style={styles.help}>Tick chunks in this room. Paste the pairing token here; it is not saved in browser storage.</Text>
      {chunks.length === 0 ? <Text style={styles.help}>Add a note in this room before asking.</Text> : null}
      {chunks.map((chunk) => {
        const selected = selectedIds.includes(chunk.id);
        const label = chunk.body.split('\n')[0]?.slice(0, 80) || 'Empty chunk';
        return (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={`Include chunk ${label}`}
            key={chunk.id}
            onPress={() => {
              setSelectedIds((current) =>
                current.includes(chunk.id) ? current.filter((id) => id !== chunk.id) : [...current, chunk.id],
              );
            }}
            style={styles.scenario}
            testID={`select-chunk-${chunk.id}`}
          >
            <Text style={styles.scenarioText}>{selected ? 'Included' : 'Include'} · {label}</Text>
          </Pressable>
        );
      })}
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
      <Text style={styles.label}>Purpose</Text>
      <View style={styles.scenarios}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pin an answer"
          accessibilityState={{ selected: purpose === 'answer' }}
          onPress={() => setPurpose('answer')}
          style={[styles.scenario, purpose === 'answer' ? styles.scenarioSelected : null]}
          testID="purpose-answer"
        >
          <Text style={purpose === 'answer' ? styles.scenarioTextSelected : styles.scenarioText}>Pin answer</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit a note"
          accessibilityState={{ selected: purpose === 'edit' }}
          onPress={() => setPurpose('edit')}
          style={[styles.scenario, purpose === 'edit' ? styles.scenarioSelected : null]}
          testID="purpose-edit"
        >
          <Text style={purpose === 'edit' ? styles.scenarioTextSelected : styles.scenarioText}>Edit note</Text>
        </Pressable>
      </View>
      {editNeedsOne ? <Text style={styles.help}>Select one chunk. An edit replaces that whole note.</Text> : null}
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
          <Text style={styles.buttonText}>{busy ? 'Working…' : purpose === 'edit' ? 'Propose edit' : 'Ask'}</Text>
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
      {proposal && !isEditProposal(proposal) ? (
        <AskProposalCard
          body={proposal.body}
          busy={busy}
          chunks={chunks}
          confirmDisabled={confirmDisabled}
          onConfirm={() => {
            void onConfirm();
          }}
          onDecline={() => {
            void onDiscard();
          }}
          onOpen={onOpenCitation}
          proposal={proposal}
          selectedChunkIds={session?.selectedChunkIds ?? []}
        />
      ) : null}
      {proposal && isEditProposal(proposal) ? (
        <EditProposalReview
          proposal={proposal}
          title={`${chunks.find((chunk) => chunk.id === proposal.chunkId)?.body.split('\n')[0]?.slice(0, 60) || 'Chunk'}`}
          confirmDisabled={confirmDisabled}
          busy={busy}
          onConfirm={() => { void onConfirm(); }}
          onDiscard={() => { void onDiscard(); }}
        />
      ) : null}
      {error && !proposal && /timed out/i.test(error) ? (
        <AskTimeoutNotice disabled={continueDisabled} onContinue={() => { void onAsk(true); }} />
      ) : null}
      {error && proposal && isEditProposal(proposal) && error.startsWith('Stale revision') ? (
        <StaleEditNotice disabled={busy} onAskAgain={() => { void onAsk(false); }} />
      ) : error ? (
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

const useStyles = createStyles((theme) => {
  const colors = harnessColors(theme.color);
  return StyleSheet.create({
    box: {
      borderColor: colors.border,
      borderRadius: 8,
      borderWidth: 1,
      marginTop: 16,
      padding: 12,
    },
    heading: { ...theme.text('cardTitle'),
      color: colors.heading,
    },
    runtime: { ...theme.text('label'),
      color: colors.help,
      marginTop: 4,
    },
    help: { ...theme.text('label'),
      color: colors.help,
      marginTop: 6,
    },
    label: { ...theme.text('label'),
      color: colors.label,
      marginBottom: 6,
      marginTop: 12,
    },
    input: { ...theme.text('bodySmall'),
      borderColor: colors.border,
      borderRadius: 8,
      borderWidth: 1,
      color: colors.input,
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
      borderColor: colors.border,
      borderRadius: 8,
      borderWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    scenarioSelected: {
      backgroundColor: colors.selectedFill,
      borderColor: colors.selectedText,
    },
    scenarioText: { ...theme.text('label'),
      color: colors.heading,
    },
    scenarioTextSelected: { ...theme.text('label'),
      color: colors.selectedText,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 12,
    },
    button: {
      backgroundColor: colors.selectedFill,
      borderRadius: 8,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    buttonDisabled: {
      opacity: 0.45,
    },
    buttonText: { ...theme.text('buttonCompact'),
      color: colors.selectedText,
    },
    secondary: {
      borderColor: colors.heading,
      borderRadius: 8,
      borderWidth: 1,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    secondaryText: { ...theme.text('bodySmall'),
      color: colors.heading,
    },
    proposal: {
      backgroundColor: colors.proposalSurface,
      borderRadius: 8,
      marginTop: 12,
      padding: 12,
    },
    proposalTitle: {
      color: colors.proposalTitle,
      fontWeight: '600',
      marginBottom: 4,
    },
    error: {
      color: colors.error,
      marginTop: 8,
    },
  });
});
