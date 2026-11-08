import { useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { StoneText, useStoneTheme } from '../../../design-theme/src/primitives';
import type { Chunk } from '../../data/models';
import Svg, { Path } from 'react-native-svg';

import { Icon } from '../../ui/Icon';
import { consumeCommaList, isSubmitShortcut, splitAt } from '../notes/note-ops';
import { formatNote, type NoteFormat, type NoteSelection } from '../notes/formatting';
import { NotePreview } from '../notes/NotePreview';
import { LIMITS } from '../../data/operations';
import { deleteAfterFlush, type AutosaveController, type AutosaveState } from './autosave';
import { DraftRevision, saveBodyWithBase } from './draft-revision';
import { readDraft, syncChunkDraft } from './draft-store';
import { useAutosave } from './use-autosave';

/** What a parent returns after trying a change: the chunk's new revision, or why it failed. */
export type EditResult = { ok: true; revision?: number; pending?: boolean } | { ok: false; message: string };

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
  /**
   * The note's text was cleared and the field left. The parent removes the
   * note with an undo; `previousBody` is the last text it had, for Undo.
   */
  onEmptied?(previousBody: string, expectedRevision: number): Promise<EditResult>;
  /** Split at the cursor: the note keeps `head`, a new note below gets `tail`. */
  onSplit?(head: string, tail: string, expectedRevision: number): Promise<EditResult>;
  /** Merge the next note into this one. Undefined when there is no next note. */
  onMergeNext?(expectedRevision: number): Promise<EditResult>;
  /** Open a composer for a new note right below this one. */
  onAddBelow?(): void;
  /** Reordering is off while the list is filtered (positions would be misleading). */
  reorderDisabled?: boolean;
  /** Rendered at the very bottom of the card (the "add below" composer). */
  after?: ReactNode;
}

/**
 * Editable chunk (#38) with autosave (#39). It does not write to the database
 * itself: the room screen passes callbacks that go through the commit boundary.
 */
export function ChunkEditor({
  chunk, index, count, onSaveBody, onSetSubjects, onMove, onDelete, onError, children,
  highlighted = false, readView, onExitReadView, testID, nativeID,
  onEmptied, onSplit, onMergeNext, onAddBelow, reorderDisabled = false, after,
}: ChunkEditorProps) {
  const theme = useStoneTheme();
  const n = index + 1;
  const phone = useWindowDimensions().width < 640;
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [details, setDetails] = useState(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const selectionRef = useRef<NoteSelection>({ start: 0, end: 0 });
  // Set only to place the caret after a format command. Keeping it controlled
  // on every keystroke jumps the cursor back on web.
  const [selection, setSelection] = useState<NoteSelection | undefined>();

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

  // The last text this note had, so emptying it can be undone.
  const lastText = useRef(chunk.body);
  useEffect(() => {
    if (chunk.body.trim()) lastText.current = chunk.body;
  }, [chunk.body]);
  const caret = useRef<number | null>(null);

  const applyFormat = (format: NoteFormat) => {
    const next = formatNote(controller.current.text ?? chunk.body, selectionRef.current, format);
    if (next.text.length > LIMITS.body) { onError('This note is too long to add formatting. Split it first.'); return; }
    revisionsRef.current?.noteEdit(chunk.revision);
    setView({ written: revisionsRef.current?.written ?? 0, frozen: revisionsRef.current?.frozen ?? null });
    controller.edit(next.text);
    selectionRef.current = next.selection;
    setSelection(next.selection);
    input.current?.focus();
  };

  const leaveField = async () => {
    await controller.flush();
    const current = controller.current.text ?? chunk.body;
    if (current.trim() || !onEmptied || !lastText.current.trim()) return;
    const result = await deleteAfterFlush(
      controller,
      () => revisionsRef.current?.expectedStructural(chunkRevision.current) ?? chunk.revision,
      (rev) => onEmptied(lastText.current, rev),
    );
    if (!result.ok) onError(result.message);
  };

  const split = () => {
    if (!onSplit) return;
    const text = controller.current.text ?? chunk.body;
    const parts = splitAt(text, caret.current ?? -1);
    if (!parts) {
      onError('Put the cursor where the note should split, with text on both sides.');
      return;
    }
    void run((rev) => onSplit(parts.head, parts.tail, rev));
  };

  const [subjectDraft, setSubjectDraft] = useState('');
  const subjectDraftRef = useRef('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const confirmingDelete = confirmingId === chunk.id;
  const [deleting, setDeleting] = useState(false);
  const doDelete = () => {
    if (deleting) return;
    setDeleting(true);
    void deleteAfterFlush(
      controller,
      () => revisionsRef.current?.expectedStructural(chunkRevision.current) ?? chunk.revision,
      onDelete,
    ).then((result) => {
      if (!result.ok) onError(result.message);
      setConfirmingId(null);
    }).finally(() => {
      setDeleting(false);
    });
  };
  const addSubjects = () => {
    const added = consumeCommaList(subjectDraftRef);
    setSubjectDraft('');
    if (!added.length) return;
    void run((rev) => onSetSubjects([...chunk.subjects, ...added], rev));
  };

  return (
    <View
      testID={testID}
      nativeID={nativeID}
      style={{
        backgroundColor: theme.color.bg.surface,
        borderColor: state.status === 'error' ? theme.color.status.danger.fill
          : highlighted ? theme.color.status.warning.fill : theme.color.border.hairline,
        borderWidth: highlighted ? 2 : 1,
        borderRadius: theme.radius.sm,
        paddingTop: theme.space.inner,
        paddingBottom: theme.space.inner,
        paddingRight: phone ? theme.space.card : theme.space.paperX,
        paddingLeft: phone ? theme.space.card : theme.space.paperX,
        gap: theme.space.xl,
        ...(editing ? { outlineWidth: 2, outlineStyle: 'solid', outlineColor: theme.color.text.primary, outlineOffset: 2 } : null),
      }}>
      {phone || !details ? null : (
        <View style={{ position: 'absolute', left: 10, top: 14, gap: 2 }}>
          <HandleButton direction="up" label={`Move chunk ${n} up`} disabled={reorderDisabled || index === 0}
            onPress={() => void run((rev) => onMove(index - 1, rev))} />
          <HandleButton direction="down" label={`Move chunk ${n} down`} disabled={reorderDisabled || index === count - 1}
            onPress={() => void run((rev) => onMove(index + 1, rev))} />
        </View>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.md }}>
        <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>{`Note ${n}`}</Text>
        <View style={{ flexDirection: 'row', gap: theme.space.base }}>
          <TextAction label={preview ? 'Write' : 'Read'} accessibilityLabel={`${preview ? 'Write' : 'Read'} note ${n}`} onPress={() => setPreview((value) => !value)} />
          <TextAction label={details ? 'Hide details' : 'Details'} accessibilityLabel={`${details ? 'Hide' : 'Show'} details for note ${n}`} onPress={() => setDetails((value) => !value)} />
        </View>
      </View>
      {!preview && !readView ? <View accessibilityLabel={`Formatting for note ${n}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.xs, borderBottomWidth: 1, borderBottomColor: theme.color.border.hairline, paddingBottom: theme.space.md }}>
        {([['heading', 'H2', 'Heading'], ['bold', 'B', 'Bold'], ['italic', 'I', 'Italic'], ['bullet', '• List', 'Bullet list'], ['quote', '“ Quote', 'Quote']] as const).map(([format, label, accessible]) =>
          <Pressable key={format} accessibilityRole="button" accessibilityLabel={`${accessible} in note ${n}`} onPress={() => applyFormat(format)}
            style={({ pressed }) => ({ minWidth: theme.layout.control, minHeight: theme.layout.control, paddingHorizontal: theme.space.md, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radius.sm, backgroundColor: pressed ? theme.color.bg.inset : undefined })}>
            <Text style={[theme.text('meta'), { color: theme.color.text.secondary, fontWeight: format === 'bold' ? '700' : '500', fontStyle: format === 'italic' ? 'italic' : 'normal' }]}>{label}</Text>
          </Pressable>)}
      </View> : null}
      {readView ? (
        <View style={{ gap: theme.space.sm }}>
          {readView}
          {onExitReadView ? (
            <TextAction label="Edit text" accessibilityLabel={`Edit chunk ${n} text`} onPress={onExitReadView} />
          ) : null}
        </View>
      ) : preview ? <NotePreview body={body} /> : (
      <TextInput
        ref={input}
        accessibilityLabel={`Chunk ${n}`}
        placeholder="Start writing…"
        placeholderTextColor={theme.color.text.tertiary}
        multiline
        textAlignVertical="top"
        value={body}
        selection={selection}
        onChangeText={(text) => {
          const revisions = revisionsRef.current;
          if (!revisions) return;
          revisions.noteEdit(chunk.revision);
          setView({ written: revisions.written, frozen: revisions.frozen });
          controller.edit(text);
        }}
        onFocus={() => setEditing(true)}
        onBlur={() => { setEditing(false); void leaveField(); }}
        onSelectionChange={(event) => {
          caret.current = event.nativeEvent.selection.start;
          selectionRef.current = event.nativeEvent.selection;
          if (selection) setSelection(undefined);
        }}
        onKeyPress={(event) => {
          if (!isSubmitShortcut(event as unknown as Parameters<typeof isSubmitShortcut>[0])) return;
          (event as unknown as { preventDefault?: () => void }).preventDefault?.();
          split();
        }}
        onContentSizeChange={(event) => setContentHeight(event.nativeEvent.contentSize.height)}
        scrollEnabled={false}
        style={[
          theme.text('reading'),
          { color: theme.color.text.primary, minHeight: theme.layout.control, height: Math.max(theme.layout.control, contentHeight), padding: 0 },
        ]}
      />
      )}

      {details ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space.sm }}>
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
              paddingLeft: theme.space.lg,
              paddingRight: theme.space.xs,
              borderRadius: theme.radius.pill,
              backgroundColor: theme.color.bg.inset,
              opacity: pressed ? 0.6 : 1,
            })}>
            <Text style={[theme.text('label'), { color: theme.color.text.secondary }]}>{subject}</Text>
            <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="cross" size={12} color={theme.color.text.tertiary} strokeWidth={2.5} />
            </View>
          </Pressable>
        ))}
        <TextInput
          accessibilityLabel={`Add subject to chunk ${n}`}
          placeholder="+ subject"
          placeholderTextColor={theme.color.text.tertiary}
          autoCapitalize="none"
          returnKeyType="done"
          value={subjectDraft}
          onChangeText={(text) => { subjectDraftRef.current = text; setSubjectDraft(text); }}
          onSubmitEditing={addSubjects}
          onBlur={addSubjects}
          style={[theme.text('label'), {
            color: theme.color.text.primary, minHeight: theme.layout.habit, minWidth: 96, paddingHorizontal: theme.space.lg,
            borderRadius: theme.radius.pill, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.color.border.strong,
          }]}
        />
      </View> : null}

      <SaveStatus state={state} onRetry={() => void controller.retry()} />
      {state.status === 'error' && view.frozen !== null && chunk.revision !== view.frozen ? (
        <Text style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>
          {`Latest saved note: ${chunk.body}`}
        </Text>
      ) : null}
      {children}

      {confirmingDelete ? (
        <View
          accessibilityRole="alert"
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: theme.space.lg,
            paddingVertical: theme.space.md,
            paddingLeft: theme.space.xl,
            paddingRight: theme.space.md,
            borderRadius: theme.radius.control,
            backgroundColor: theme.color.status.danger.wash,
          }}>
          <Text style={[theme.text('bodySmall'), { flex: 1, minWidth: 160, color: theme.color.status.danger.text }]}>
            {`Delete note ${n}? You will have a moment to undo.`}
          </Text>
          <TextAction
            label={deleting ? 'Deleting…' : 'Confirm delete'}
            accessibilityLabel={`Confirm delete chunk ${n}`}
            tone="danger"
            disabled={deleting}
            onPress={doDelete}
          />
          <TextAction
            label="Keep it"
            accessibilityLabel={`Cancel delete chunk ${n}`}
            disabled={deleting}
            onPress={() => setConfirmingId(null)}
          />
        </View>
      ) : null}

      {details ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.md }}>
        <StoneText role="fine" tone="tertiary">
          {`Note ${n} · edited ${new Date(chunk.updatedAt).toLocaleString()}`}
        </StoneText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: theme.space.base }}>
          {onAddBelow ? <TextAction label="Add below" accessibilityLabel={`Add a note below chunk ${n}`} onPress={onAddBelow} /> : null}
          {onSplit ? <TextAction label="Split" accessibilityLabel={`Split chunk ${n} at the cursor`} disabled={Boolean(readView)} onPress={split} /> : null}
          {onMergeNext ? (
            <TextAction label="Merge next" accessibilityLabel={`Merge chunk ${n + 1} into chunk ${n}`} onPress={() => void run((rev) => onMergeNext(rev))} />
          ) : null}
          <TextAction label="Top" accessibilityLabel={`Move chunk ${n} to the top`} disabled={reorderDisabled || index === 0} onPress={() => void run((rev) => onMove(0, rev))} />
          {phone ? <>
            <TextAction label="Up" accessibilityLabel={`Move chunk ${n} up`} disabled={reorderDisabled || index === 0} onPress={() => void run((rev) => onMove(index - 1, rev))} />
            <TextAction label="Down" accessibilityLabel={`Move chunk ${n} down`} disabled={reorderDisabled || index === count - 1} onPress={() => void run((rev) => onMove(index + 1, rev))} />
          </> : null}
          <TextAction label="Bottom" accessibilityLabel={`Move chunk ${n} to the bottom`} disabled={reorderDisabled || index === count - 1} onPress={() => void run((rev) => onMove(count - 1, rev))} />
          {confirmingDelete ? null : (
          <TextAction
            label="Delete"
            accessibilityLabel={`Delete chunk ${n}`}
            tone="danger"
            onPress={() => setConfirmingId(chunk.id)}
          />
          )}
        </View>
      </View> : null}
      {after}
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
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: theme.space.lg,
          paddingVertical: theme.space.md,
          paddingLeft: theme.space.xl,
          paddingRight: theme.space.md,
          borderRadius: theme.radius.control,
          backgroundColor: theme.color.status.danger.wash,
        }}>
        <Icon name="cross" size={16} color={theme.color.status.danger.text} strokeWidth={2.5} />
        <Text style={[theme.text('meta'), { flex: 1, minWidth: 160, color: theme.color.status.danger.text }]}>
          {`couldn't save${state.error ? ` (${state.error})` : ''}. this text is kept here until it does.`}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Retry save" onPress={onRetry}
          style={({ pressed }) => ({
            minHeight: 36, paddingHorizontal: theme.space.xl, borderRadius: theme.radius.lg, justifyContent: 'center',
            backgroundColor: theme.color.status.danger.fill, opacity: pressed ? 0.7 : 1,
          })}>
          <Text style={[theme.text('meta'), { color: theme.color.text.onFill }]}>retry save</Text>
        </Pressable>
      </View>
    );
  }
  if (state.text === null) return null;
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

/** Up/down reorder handle shown in the card's left gutter on wide screens. */
function HandleButton({ direction, label, disabled, onPress }: {
  direction: 'up' | 'down'; label: string; disabled: boolean; onPress: () => void;
}) {
  const theme = useStoneTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ width: 36, height: 36, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={disabled ? theme.color.text.disabled : theme.color.text.tertiary}
        strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <Path d={direction === 'up' ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
      </Svg>
    </Pressable>
  );
}
