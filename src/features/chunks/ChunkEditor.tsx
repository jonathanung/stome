import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Button, StoneText, useStoneTheme } from '../../../design-theme/src/primitives';
import type { Chunk } from '../../data/models';
import { deleteAfterFlush, type AutosaveController, type AutosaveState } from './autosave';
import { DraftRevision, saveBodyWithBase } from './draft-revision';
import { readDraft, syncChunkDraft } from './draft-store';
import { useAutosave } from './use-autosave';

/** What a parent returns after trying a change: the chunk's new revision, or why it failed. */
export type EditResult = { ok: true; revision?: number } | { ok: false; message: string };

export interface ChunkEditorProps {
  chunk: Chunk;
  index: number;
  count: number;
  onSaveBody(body: string, expectedRevision: number): Promise<EditResult>;
  onSetSubjects(subjects: string[], expectedRevision: number): Promise<EditResult>;
  onMove(toIndex: number, expectedRevision: number): Promise<EditResult>;
  onDelete(expectedRevision: number): Promise<EditResult>;
  /** Shown by the parent; failed body saves are shown here instead, with retry. */
  onError(message: string): void;
  /** Extra content for the bottom of the card (source link, annotations). */
  children?: ReactNode;
  /** Draws the card with the warning border, e.g. when an AI citation points into it. */
  highlighted?: boolean;
  /**
   * A read-only view shown instead of the text field (e.g. the cited passage
   * highlighted). "Edit text" calls onExitReadView to return to editing.
   */
  readView?: ReactNode;
  onExitReadView?(): void;
  testID?: string;
  nativeID?: string;
}

/**
 * Editable chunk (#38) with autosave (#39). It does not write to the database
 * itself: the room screen passes callbacks that go through the commit boundary.
 */
export function ChunkEditor({
  chunk, index, count, onSaveBody, onSetSubjects, onMove, onDelete, onError, children,
  highlighted = false, readView, onExitReadView, testID, nativeID,
}: ChunkEditorProps) {
  const theme = useStoneTheme();
  const n = index + 1;

  // Draft base is frozen on the first keystroke. Render reads `view`, which
  // is state copied from that record after each edit or save.
  const [boot] = useState(() => readDraft(chunk.id));
  const revisionsRef = useRef<DraftRevision | null>(null);
  if (revisionsRef.current == null) {
    const created = new DraftRevision();
    if (boot) created.restore(boot);
    revisionsRef.current = created;
  }
  const chunkRevision = useRef(chunk.revision);
  const controllerRef = useRef<AutosaveController | null>(null);
  const [view, setView] = useState(() => ({
    written: boot?.writtenRevision ?? 0,
    frozen: boot?.baseRevision ?? null,
  }));
  useEffect(() => {
    chunkRevision.current = chunk.revision;
  }, [chunk.revision]);

  const onPersist = useCallback((next: AutosaveState) => {
    const revisions = revisionsRef.current;
    if (!revisions) return;
    syncChunkDraft(chunk.id, next, revisions.snapshot());
  }, [chunk.id]);
  const { state, controller } = useAutosave(
    async (body) => {
      const revisions = revisionsRef.current;
      if (!revisions) return { ok: false, message: 'editor is not ready' };
      const outcome = await saveBodyWithBase(
        revisions,
        chunkRevision.current,
        body,
        () => controllerRef.current?.current.text ?? null,
        (expected) => onSaveBody(body, expected),
      );
      setView({ written: revisions.written, frozen: revisions.frozen });
      return outcome;
    },
    {
      initial: boot ? { status: boot.status, text: boot.text, error: boot.error } : undefined,
      onPersist,
    },
  );
  useEffect(() => {
    controllerRef.current = controller;
  }, [controller]);

  // Show the typed text until the database has caught up with it. A dirty or
  // failed draft stays on screen even when a newer body arrives in props.
  const showTyped = state.text !== null && (state.status !== 'saved' || chunk.revision <= view.written);
  const body = showTyped ? state.text! : chunk.body;

  /** Tag and move wait for pending text, then use the revision that flush produced. */
  const run = async (change: (rev: number) => Promise<EditResult>) => {
    const revisions = revisionsRef.current;
    if (!revisions) return;
    await controller.flush();
    const sent = revisions.expectedStructural(chunkRevision.current);
    const result = await change(sent);
    if (result.ok && result.revision !== undefined) {
      revisions.noteStructural(sent, result.revision);
      setView({ written: revisions.written, frozen: revisions.frozen });
    }
    if (!result.ok) onError(result.message);
  };

  // Multiline fields do not grow by themselves (on web they scroll), so size
  // the field to its content: a chunk is always shown whole.
  const [contentHeight, setContentHeight] = useState(0);

  const [subjectDraft, setSubjectDraft] = useState('');
  const addSubjects = () => {
    const added = subjectDraft.split(',').map((s) => s.trim()).filter(Boolean);
    if (!added.length) return;
    setSubjectDraft('');
    void run((rev) => onSetSubjects([...chunk.subjects, ...added], rev));
  };

  return (
    <View
      testID={testID}
      nativeID={nativeID}
      style={{
        backgroundColor: theme.color.bg.surface,
        borderColor: highlighted ? theme.color.status.warning.fill : theme.color.border.hairline,
        borderWidth: highlighted ? 2 : 1,
        borderRadius: theme.radius.card,
        padding: theme.space.base,
        gap: theme.space.md,
      }}>
      {readView ? (
        <View style={{ gap: theme.space.sm }}>
          {readView}
          {onExitReadView ? (
            <TextAction label="Edit text" accessibilityLabel={`Edit chunk ${n} text`} onPress={onExitReadView} />
          ) : null}
        </View>
      ) : (
      <TextInput
        accessibilityLabel={`Chunk ${n}`}
        placeholder="Empty chunk"
        placeholderTextColor={theme.color.text.tertiary}
        multiline
        textAlignVertical="top"
        value={body}
        onChangeText={(text) => {
          const revisions = revisionsRef.current;
          if (!revisions) return;
          revisions.noteEdit(chunk.revision);
          setView({ written: revisions.written, frozen: revisions.frozen });
          controller.edit(text);
        }}
        onBlur={() => void controller.flush()}
        onContentSizeChange={(event) => setContentHeight(event.nativeEvent.contentSize.height)}
        scrollEnabled={false}
        style={[
          theme.text('reading'),
          { color: theme.color.text.primary, minHeight: theme.layout.control, height: Math.max(theme.layout.control, contentHeight), padding: 0 },
        ]}
      />
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space.sm }}>
        {chunk.subjects.map((subject) => (
          <Pressable
            key={subject}
            accessibilityRole="button"
            accessibilityLabel={`Remove subject ${subject}`}
            hitSlop={8}
            onPress={() => void run((rev) => onSetSubjects(chunk.subjects.filter((s) => s !== subject), rev))}
            style={({ pressed }) => ({
              flexDirection: 'row',
              gap: theme.space.xs,
              minHeight: theme.layout.habit,
              alignItems: 'center',
              paddingHorizontal: theme.space.lg,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.bg.inset,
              opacity: pressed ? 0.6 : 1,
            })}>
            <Text style={[theme.text('label'), { color: theme.color.text.secondary }]}>{subject}</Text>
            <Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>×</Text>
          </Pressable>
        ))}
        <TextInput
          accessibilityLabel={`Add subject to chunk ${n}`}
          placeholder="+ subject"
          placeholderTextColor={theme.color.text.tertiary}
          autoCapitalize="none"
          returnKeyType="done"
          value={subjectDraft}
          onChangeText={setSubjectDraft}
          onSubmitEditing={addSubjects}
          onBlur={addSubjects}
          style={[theme.text('search'), { color: theme.color.text.primary, minHeight: theme.layout.chip, minWidth: 120, padding: 0 }]}
        />
      </View>

      <SaveStatus state={state} onRetry={() => void controller.retry()} />
      {state.status === 'error' && view.frozen !== null && chunk.revision !== view.frozen ? (
        <Text style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>
          {`Latest saved note: ${chunk.body}`}
        </Text>
      ) : null}
      {children}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.md }}>
        <StoneText role="fine" tone="tertiary">
          {`Chunk ${n} · edited ${new Date(chunk.updatedAt).toLocaleString()}`}
        </StoneText>
        <View style={{ flexDirection: 'row', gap: theme.space.base }}>
          <TextAction label="↑" accessibilityLabel={`Move chunk ${n} up`} disabled={index === 0} onPress={() => void run((rev) => onMove(index - 1, rev))} />
          <TextAction label="↓" accessibilityLabel={`Move chunk ${n} down`} disabled={index === count - 1} onPress={() => void run((rev) => onMove(index + 1, rev))} />
          <TextAction
            label="Delete"
            accessibilityLabel={`Delete chunk ${n}`}
            tone="danger"
            onPress={() => {
              void deleteAfterFlush(
                controller,
                () => revisionsRef.current?.expectedStructural(chunkRevision.current) ?? chunk.revision,
                onDelete,
              ).then((result) => {
                if (!result.ok) onError(result.message);
              });
            }}
          />
        </View>
      </View>
    </View>
  );
}

const STATUS_LABEL = { saved: 'Saved', unsaved: 'Unsaved changes', saving: 'Saving…' } as const;

/** Visible saved / unsaved / error state. A failed save keeps the text and offers retry. */
function SaveStatus({ state, onRetry }: { state: AutosaveState; onRetry: () => void }) {
  const theme = useStoneTheme();
  if (state.status === 'error') {
    return (
      <View
        accessibilityRole="alert"
        style={{
          gap: theme.space.md,
          padding: theme.space.lg,
          borderRadius: theme.radius.control,
          backgroundColor: theme.color.status.danger.wash,
        }}>
        <Text style={[theme.text('bodySmall'), { color: theme.color.status.danger.text }]}>
          {`Couldn't save: ${state.error}. Your text is still here.`}
        </Text>
        <View style={{ alignSelf: 'flex-start' }}>
          <Button label="Retry save" variant="outline" size="compact" onPress={onRetry} />
        </View>
      </View>
    );
  }
  if (state.text === null) return null; // nothing typed yet
  return (
    <View accessibilityLiveRegion="polite">
      <StoneText role="fine" tone={state.status === 'saved' ? 'tertiary' : 'secondary'}>
        {STATUS_LABEL[state.status]}
      </StoneText>
    </View>
  );
}

/** A small text control with a 44pt touch target recovered through hitSlop. */
function TextAction({
  label,
  accessibilityLabel,
  onPress,
  disabled = false,
  tone = 'secondary',
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'secondary' | 'danger';
}) {
  const theme = useStoneTheme();
  const color = disabled ? theme.color.text.disabled : tone === 'danger' ? theme.color.status.danger.text : theme.color.text.secondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
      style={({ pressed }) => ({ minHeight: 20, minWidth: 20, alignItems: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Text style={[theme.text('meta'), { color }]}>{label}</Text>
    </Pressable>
  );
}
