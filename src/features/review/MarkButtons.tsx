import { randomUUID } from 'expo-crypto';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import type { Commit } from '../../data/commit.ts';
import type { ReviewState } from '../../db/schema.ts';
import { Icon } from '../../ui/Icon';
import { REVIEW_ICON, REVIEW_TONE } from '../../ui/StatusMark';
import { Notice } from '../../ui/kit';
import { reviewMarkController } from './mark-attempt';
import { REVIEW_LABEL, deviceTimeZone } from './session';

const STATES: readonly ReviewState[] = ['missed', 'unclear', 'got_it'];

/**
 * Unclear / Missed / Got-it buttons for one chunk — or one pinned answer —
 * via `review.mark` (#128). The write goes through the shared mark controller
 * so Today refreshes when a Room mark lands and a lost response can be
 * retried without double credit. A failed mark keeps the prior state on
 * screen and shows Retry.
 */
export function MarkButtons({
  chunkId,
  annotationId,
  expectedRevision,
  commit,
  testID,
}: {
  chunkId: string;
  annotationId?: string;
  expectedRevision: number;
  commit: Commit;
  testID: string;
}) {
  const theme = useStoneTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryState, setRetryState] = useState<ReviewState | null>(null);

  const key = annotationId ?? chunkId;
  const held = !busy ? reviewMarkController.retained(key) : null;
  const heldLabel = held ? REVIEW_LABEL[held.payload.state] : null;

  async function mark(state: ReviewState) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setRetryState(null);
    try {
      const outcome = await reviewMarkController.submit({
        newId: randomUUID,
        timeZone: deviceTimeZone,
        commit: async (attempt) => commit(attempt),
        request:
          annotationId === undefined
            ? { chunkId, state, expectedRevision }
            : { chunkId, annotationId, state, expectedRevision },
        report: () => undefined,
      });
      if (outcome.status === 'busy') return;
      if (outcome.status === 'blocked') {
        const previous = REVIEW_LABEL[outcome.attempt.payload.state];
        setError(`The previous ${previous} mark did not finish. Retry that choice. It will not be counted twice.`);
        setRetryState(outcome.attempt.payload.state);
        return;
      }
      if (outcome.status === 'ambiguous') {
        setError('That mark may have saved. Retry the same choice. It will not be counted twice.');
        setRetryState(state);
        return;
      }
      if (outcome.status !== 'rejected') return;
      const failure = outcome.result.error;
      if (failure.code === 'stale_revision') {
        setError(
          annotationId === undefined
            ? 'This note changed since you opened it. Nothing was saved and it did not count. Reload, then mark it again.'
            : 'This saved answer no longer matches the note. Nothing was saved and it did not count. Ask again, then mark the new answer.',
        );
        setRetryState(state);
        return;
      }
      if (failure.code === 'not_found') {
        setError(annotationId === undefined ? 'This note no longer exists.' : 'This saved answer no longer exists.');
        return;
      }
      setError(failure.message);
      setRetryState(state);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the mark');
      setRetryState(state);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: theme.space.sm }}>
      <View
        accessibilityRole="group"
        accessibilityLabel={annotationId ? 'Mark this saved answer' : 'Mark this note'}
        style={{ flexDirection: 'row', gap: theme.space.sm }}
      >
        {STATES.map((state) => {
          const fill = theme.color.status[REVIEW_TONE[state]].fill;
          const onFill = theme.color.text.onFill;
          return (
            <Pressable
              key={state}
              accessibilityRole="button"
              accessibilityLabel={`Mark as ${REVIEW_LABEL[state].toLowerCase()}`}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              testID={`${testID}-${state}`}
              onPress={() => void mark(state)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: 44,
                borderRadius: theme.radius.lg,
                backgroundColor: fill,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 6,
                paddingHorizontal: theme.space.sm,
                opacity: busy ? 0.5 : pressed ? 0.75 : 1,
              })}
            >
              <Icon name={REVIEW_ICON[state]} size={16} strokeWidth={2.75} color={onFill} />
              <Text style={[theme.text('buttonCompact'), { color: onFill }]}>{REVIEW_LABEL[state]}</Text>
            </Pressable>
          );
        })}
      </View>
      {held && !error ? (
        <Notice tone="warning" testID={`${testID}-pending`}>
          {`The previous ${heldLabel} mark did not finish. Retry that choice. It will not be counted twice.`}
        </Notice>
      ) : null}
      {held && !error ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Retry ${heldLabel} mark`}
          testID={`${testID}-retry`}
          disabled={busy}
          onPress={() => void mark(held.payload.state)}
          style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}
        >
          <Text style={[theme.text('buttonCompact'), { color: theme.color.text.primary, textDecorationLine: 'underline' }]}>
            {`Retry ${heldLabel}`}
          </Text>
        </Pressable>
      ) : null}
      {error ? <Notice tone="danger" testID={`${testID}-error`}>{error}</Notice> : null}
      {error && retryState ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Retry ${REVIEW_LABEL[retryState].toLowerCase()} mark`}
          testID={`${testID}-retry`}
          disabled={busy}
          onPress={() => void mark(retryState)}
          style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}
        >
          <Text style={[theme.text('buttonCompact'), { color: theme.color.text.primary, textDecorationLine: 'underline' }]}>
            {`Retry ${REVIEW_LABEL[retryState]}`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
