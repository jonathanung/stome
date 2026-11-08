import { randomUUID } from 'expo-crypto';
import { Link, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Screen, useStoneTheme } from '../../design-theme/src/primitives';
import { createCommit } from '../data/commit';
import type { Chunk, Room } from '../data/models';
import { getRoom, listChunks } from '../data/queries';
import { expoDriver } from '../db/expo-driver';
import { SubjectChips } from '../features/room/PhoneRoomChrome';
import { Icon } from '../ui/Icon';
import { BackButton, EmptyState, Field, Notice, ScreenHeader, SectionTitle, useColumn } from '../ui/kit';
import {
  STUDY_DRAFT_KINDS,
  STUDY_DRAFT_LABEL,
  distinctSubjects,
  draftItemCount,
  previewErrorMessage,
  previewStudyDraft,
  saveStudyDraft,
  type DraftCard,
  type DraftQuestion,
  type DraftSlide,
  type StudyDraft,
  type StudyDraftKind,
} from '../features/study/library';

function excerpt(body: string, max = 120): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat || '(empty chunk)' : `${flat.slice(0, max).trimEnd()}…`;
}

function chunkPosition(chunks: Chunk[], id: string): number {
  const index = chunks.findIndex((chunk) => chunk.id === id);
  return index < 0 ? 0 : index + 1;
}

/** "chunk 3 of 8 · mitochondria make energy…" for one source ref. */
function sourceLabel(chunk: Chunk | undefined, chunks: Chunk[]): string {
  if (!chunk) return 'source chunk (deleted)';
  return `chunk ${chunkPosition(chunks, chunk.id)} of ${chunks.length} · ${excerpt(chunk.body, 60)}`;
}

function SourceRefs({ roomId, chunks, ids }: { roomId: string; chunks: Chunk[]; ids: string[] }) {
  const theme = useStoneTheme();
  return (
    <View style={{ gap: theme.space.xs }}>
      {ids.map((id) => {
        const chunk = chunks.find((c) => c.id === id);
        return (
          <Link key={id} href={`/rooms/${roomId}`} asChild>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Open source ${chunk ? `chunk ${chunkPosition(chunks, id)}` : 'chunk'} in room`}
              testID={`draft-source-${id}`}
              style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.xs }}
            >
              <Icon name="link" size={12} color={theme.color.text.tertiary} />
              <Text numberOfLines={1} style={[theme.text('label'), { flex: 1, color: theme.color.text.tertiary }]}>
                {sourceLabel(chunk, chunks)}
              </Text>
            </Pressable>
          </Link>
        );
      })}
    </View>
  );
}

function CheckRow({ checked, title, subtitle, testID, label, onToggle }: {
  checked: boolean;
  title: string;
  subtitle?: string;
  testID: string;
  label: string;
  onToggle: () => void;
}) {
  const theme = useStoneTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      testID={testID}
      onPress={onToggle}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: theme.space.lg,
        paddingVertical: theme.space.lg,
        paddingHorizontal: theme.space.base,
        borderRadius: theme.radius.control,
        backgroundColor: theme.color.bg.surface,
        borderWidth: 1,
        borderColor: checked ? theme.color.accent.bg : theme.color.border.hairline,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        aria-hidden
        style={{
          width: 22,
          height: 22,
          marginTop: 1,
          borderRadius: 6,
          borderWidth: 2,
          borderColor: checked ? theme.color.accent.bg : theme.color.border.strong,
          backgroundColor: checked ? theme.color.accent.bg : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Icon name="check" size={13} color={theme.color.accent.fg} strokeWidth={3} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: theme.space.xxs }}>
        <Text numberOfLines={2} style={[theme.text('body'), { color: theme.color.text.primary }]}>{title}</Text>
        {subtitle ? (
          <Text numberOfLines={1} style={[theme.text('label'), { color: theme.color.text.tertiary }]}>{subtitle}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function StudyLibraryPicker() {
  const { roomId } = useLocalSearchParams<{ roomId?: string }>();
  const sqlite = useSQLiteContext();
  const db = useMemo(() => expoDriver(sqlite), [sqlite]);
  const commit = useMemo(() => createCommit(db, { now: Date.now, newId: randomUUID }), [db]);
  const theme = useStoneTheme();
  const column = useColumn();

  const [room, setRoom] = useState<Room | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<StudyDraftKind>('deck');
  const [subject, setSubject] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [draft, setDraft] = useState<StudyDraft | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [opIdBase, setOpIdBase] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!roomId) return;
    const [nextRoom, notes] = await Promise.all([getRoom(db, roomId), listChunks(db, roomId)]);
    setRoom(nextRoom);
    setChunks(notes);
  }, [db, roomId]);

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    load()
      .then(() => { if (active) setLoading(false); })
      .catch((reason: unknown) => {
        if (!active) return;
        setLoadError(reason instanceof Error ? reason.message : 'Could not load notes');
        setLoading(false);
      });
    return () => { active = false; };
  }, [load]));

  const subjects = useMemo(() => distinctSubjects(chunks), [chunks]);
  const activeSubject = subject && subjects.includes(subject) ? subject : null;
  const visible = useMemo(
    () => (activeSubject ? chunks.filter((chunk) => chunk.subjects.includes(activeSubject)) : chunks),
    [chunks, activeSubject],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedChunks = useMemo(
    () => chunks.filter((chunk) => selectedSet.has(chunk.id)),
    [chunks, selectedSet],
  );

  const toggle = useCallback((id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }, []);

  const generate = useCallback(() => {
    if (!room || selectedChunks.length === 0) return;
    const title = `${room.name} ${STUDY_DRAFT_LABEL[kind].toLowerCase()}`;
    const result = previewStudyDraft(kind, title, selectedChunks);
    if (!result.ok) {
      setPreviewError(previewErrorMessage(result.error));
      return;
    }
    setPreviewError(null);
    setDraft(result.draft);
    setDraftTitle(result.draft.title);
    setOpIdBase(`study-${randomUUID()}`);
    setSaveError(null);
    setSaved(false);
  }, [room, selectedChunks, kind]);

  const closeSheet = useCallback(() => {
    if (saving) return;
    setDraft(null);
    setSaveError(null);
    setSaved(false);
  }, [saving]);

  const confirm = useCallback(async () => {
    if (!room || !draft || saving) return;
    setSaving(true);
    setSaveError(null);
    const result = await saveStudyDraft({ ...draft, title: draftTitle.trim() || draft.title }, {
      roomId: room.id,
      commit,
      newId: randomUUID,
      opIdBase,
    });
    setSaving(false);
    if (result.ok) {
      setSaved(true);
    } else {
      // The draft stays in the sheet untouched: Retry reuses the same op ids,
      // so the boundary replays finished ops as duplicates instead of doubling rows.
      setSaveError(result.error);
    }
  }, [room, draft, draftTitle, saving, commit, opIdBase]);

  const updateCard = useCallback((key: string, patch: Partial<DraftCard>) => {
    setDraft((prev) => (prev?.kind === 'deck'
      ? { ...prev, cards: prev.cards.map((card) => (card.key === key ? { ...card, ...patch } : card)) }
      : prev));
  }, []);
  const removeCard = useCallback((key: string) => {
    setDraft((prev) => (prev?.kind === 'deck' ? { ...prev, cards: prev.cards.filter((c) => c.key !== key) } : prev));
  }, []);
  const updateQuestion = useCallback((key: string, patch: Partial<DraftQuestion>) => {
    setDraft((prev) => (prev?.kind === 'quiz'
      ? { ...prev, questions: prev.questions.map((q) => (q.key === key ? { ...q, ...patch } : q)) }
      : prev));
  }, []);
  const removeQuestion = useCallback((key: string) => {
    setDraft((prev) => (prev?.kind === 'quiz' ? { ...prev, questions: prev.questions.filter((q) => q.key !== key) } : prev));
  }, []);
  const updateSlide = useCallback((key: string, patch: Partial<DraftSlide>) => {
    setDraft((prev) => (prev?.kind === 'outline'
      ? { ...prev, slides: prev.slides.map((s) => (s.key === key ? { ...s, ...patch } : s)) }
      : prev));
  }, []);
  const removeSlide = useCallback((key: string) => {
    setDraft((prev) => (prev?.kind === 'outline' ? { ...prev, slides: prev.slides.filter((s) => s.key !== key) } : prev));
  }, []);

  const itemCount = draft ? draftItemCount(draft) : 0;

  if (loading) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1 }}>
          <ActivityIndicator testID="study-picker-loading" color={theme.color.accent.bg} style={{ marginTop: 40 }} />
        </SafeAreaView>
      </Screen>
    );
  }

  if (!room) {
    return (
      <Screen>
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={[column, { paddingTop: theme.space.page, gap: theme.space.base }]}>
            <BackButton label="← rooms" accessibilityLabel="All rooms" onPress={() => router.replace('/')} />
            <EmptyState
              title="This room was not found."
              body="It may have been deleted on this device."
              testID="study-picker-missing"
            >
              <Button label="Back to rooms" size="compact" onPress={() => router.replace('/')} />
            </EmptyState>
          </ScrollView>
        </SafeAreaView>
      </Screen>
    );
  }

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} testID="study-picker">
        <FlatList
          data={visible}
          keyExtractor={(chunk) => chunk.id}
          keyboardShouldPersistTaps="handled"
          testID="study-chunk-list"
          contentContainerStyle={[column, { paddingTop: theme.space.md, paddingBottom: 120, gap: theme.space.md }]}
          ListHeaderComponent={
            <View style={{ gap: theme.space.base, marginBottom: theme.space.sm }}>
              <BackButton label="← rooms" accessibilityLabel="All rooms" onPress={() => router.replace('/')} />
              <ScreenHeader
                kicker="study"
                title={room.name}
                action={
                  <Link href={`/study?roomId=${room.id}`} asChild>
                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel="Open study library"
                      testID="study-open-library"
                      style={{ minHeight: theme.layout.control, justifyContent: 'center' }}
                    >
                      <Text style={[theme.text('buttonCompact'), { color: theme.color.text.secondary }]}>library</Text>
                    </Pressable>
                  </Link>
                }
              >
                <Text style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>
                  Tick the notes to study, then review every item before anything is saved.
                </Text>
              </ScreenHeader>
              {loadError ? <Notice tone="danger">{loadError}</Notice> : null}
              <View accessibilityRole="radiogroup" accessibilityLabel="Study set type" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
                {STUDY_DRAFT_KINDS.map((option) => {
                  const on = kind === option;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${STUDY_DRAFT_LABEL[option]} set`}
                      testID={`study-kind-${option}`}
                      onPress={() => setKind(option)}
                      style={{
                        minHeight: theme.layout.control,
                        paddingHorizontal: theme.space.xl,
                        borderRadius: theme.radius.pill,
                        borderWidth: 1,
                        justifyContent: 'center',
                        borderColor: on ? theme.color.accent.bg : theme.color.border.hairline,
                        backgroundColor: on ? theme.color.accent.bg : theme.color.bg.surface,
                      }}
                    >
                      <Text style={[theme.text('buttonCompact'), { color: on ? theme.color.accent.fg : theme.color.text.secondary }]}>
                        {STUDY_DRAFT_LABEL[option]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {subjects.length ? <SubjectChips subjects={subjects} value={activeSubject} onChange={setSubject} /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.lg }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Button
                    label={selectedChunks.length ? `Generate preview (${selectedChunks.length})` : 'Generate preview'}
                    disabled={selectedChunks.length === 0}
                    onPress={generate}
                  />
                </View>
              </View>
              <View testID="study-generate-hint">
                {selectedChunks.length === 0 ? (
                  <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>
                    Select at least one chunk below — Generate stays off until then.
                  </Text>
                ) : (
                  <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>
                    {selectedChunks.length} of {chunks.length} {chunks.length === 1 ? 'chunk' : 'chunks'} selected
                    {activeSubject ? ` · ${activeSubject}` : ''}.
                  </Text>
                )}
              </View>
              {previewError ? <Notice tone="danger" testID="study-preview-error">{previewError}</Notice> : null}
              {chunks.length ? <SectionTitle aside={<Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>{activeSubject ? `Notes · ${activeSubject}` : 'Notes'}</Text>}>Pick source notes</SectionTitle> : null}
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              title="No notes in this room yet"
              body="Write a few chunks in the room first, then come back to build a study set."
              testID="study-picker-empty"
            >
              <Button label="Open room" size="compact" onPress={() => router.push(`/rooms/${room.id}`)} />
            </EmptyState>
          }
          renderItem={({ item, index }) => (
            <CheckRow
              checked={selectedSet.has(item.id)}
              title={`${index + 1}. ${excerpt(item.body)}`}
              subtitle={`${item.subjects.length ? `${item.subjects.join(' · ')} · ` : ''}rev ${item.revision}`}
              testID={`study-chunk-${item.id}`}
              label={`Select chunk ${index + 1}${item.subjects.length ? `, subjects ${item.subjects.join(', ')}` : ''}`}
              onToggle={() => toggle(item.id)}
            />
          )}
        />

        <Modal
          visible={draft !== null}
          animationType="slide"
          onRequestClose={closeSheet}
          accessibilityViewIsModal
          testID="study-review-sheet"
        >
          <Screen>
            <SafeAreaView style={{ flex: 1 }}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={[column, { paddingTop: theme.space.md, paddingBottom: 48, gap: theme.space.base }]}
              >
                <ScreenHeader kicker="review before saving" title={draft ? STUDY_DRAFT_LABEL[draft.kind] : ''} />
                {saved ? (
                  <View style={{ gap: theme.space.base }} testID="study-saved">
                    <Notice tone="success">Saved to the library. Nothing else was written.</Notice>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md }}>
                      <Button label="View library" onPress={() => { setDraft(null); router.replace(`/study?roomId=${room.id}`); }} />
                      <Button
                        label="Make another"
                        variant="outline"
                        onPress={() => { setDraft(null); setSaved(false); setSelected([]); }}
                      />
                    </View>
                  </View>
                ) : (
                  <View style={{ gap: theme.space.base }}>
                    <Field
                      accessibilityLabel="Study set title"
                      testID="study-draft-title"
                      value={draftTitle}
                      onChangeText={setDraftTitle}
                      autoCapitalize="sentences"
                    />
                    {itemCount === 0 ? (
                      <Notice tone="warning" testID="study-draft-empty">
                        Every item was removed. Add the set again or discard this draft.
                      </Notice>
                    ) : (
                      <Text style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>
                        {itemCount} {itemCount === 1 ? 'item' : 'items'} · check each one, edit or remove what is wrong.
                      </Text>
                    )}
                    {draft?.kind === 'deck'
                      ? draft.cards.map((card, i) => (
                        <View
                          key={card.key}
                          testID={`draft-item-${card.key}`}
                          style={{
                            gap: theme.space.md, backgroundColor: theme.color.bg.surface,
                            borderRadius: theme.radius.float, borderWidth: 1, borderColor: theme.color.border.hairline,
                            padding: theme.space.base, ...theme.shadow.card,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.md }}>
                            <Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>Card {i + 1}</Text>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Remove card ${i + 1}`}
                              testID={`draft-remove-${card.key}`}
                              hitSlop={8}
                              onPress={() => removeCard(card.key)}
                              style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
                            >
                              <Icon name="cross" size={18} color={theme.color.status.danger.text} />
                            </Pressable>
                          </View>
                          <Field accessibilityLabel={`Card ${i + 1} front`} value={card.front} multiline onChangeText={(v) => updateCard(card.key, { front: v })} />
                          <Field accessibilityLabel={`Card ${i + 1} back`} value={card.back} multiline onChangeText={(v) => updateCard(card.key, { back: v })} />
                          <SourceRefs roomId={room.id} chunks={chunks} ids={card.sourceChunkIds} />
                        </View>
                      ))
                      : null}
                    {draft?.kind === 'quiz'
                      ? draft.questions.map((question, i) => (
                        <View
                          key={question.key}
                          testID={`draft-item-${question.key}`}
                          style={{
                            gap: theme.space.md, backgroundColor: theme.color.bg.surface,
                            borderRadius: theme.radius.float, borderWidth: 1, borderColor: theme.color.border.hairline,
                            padding: theme.space.base, ...theme.shadow.card,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.md }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
                              <Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>Question {i + 1}</Text>
                              <Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>{question.kind.replace('_', ' ')}</Text>
                            </View>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Remove question ${i + 1}`}
                              testID={`draft-remove-${question.key}`}
                              hitSlop={8}
                              onPress={() => removeQuestion(question.key)}
                              style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
                            >
                              <Icon name="cross" size={18} color={theme.color.status.danger.text} />
                            </Pressable>
                          </View>
                          <Field accessibilityLabel={`Question ${i + 1} stem`} value={question.stem} multiline onChangeText={(v) => updateQuestion(question.key, { stem: v })} />
                          {question.kind === 'mcq' ? (
                            <Field
                              accessibilityLabel={`Question ${i + 1} choices, comma separated`}
                              value={question.choices.join(', ')}
                              onChangeText={(v) => updateQuestion(question.key, { choices: v.split(',').map((c) => c.trim()) })}
                            />
                          ) : null}
                          <Field accessibilityLabel={`Question ${i + 1} answer`} value={question.answer} onChangeText={(v) => updateQuestion(question.key, { answer: v })} />
                          <Field accessibilityLabel={`Question ${i + 1} explanation`} value={question.explanation} multiline onChangeText={(v) => updateQuestion(question.key, { explanation: v })} />
                          <SourceRefs roomId={room.id} chunks={chunks} ids={question.sourceChunkIds} />
                        </View>
                      ))
                      : null}
                    {draft?.kind === 'outline'
                      ? draft.slides.map((slide, i) => (
                        <View
                          key={slide.key}
                          testID={`draft-item-${slide.key}`}
                          style={{
                            gap: theme.space.md, backgroundColor: theme.color.bg.surface,
                            borderRadius: theme.radius.float, borderWidth: 1, borderColor: theme.color.border.hairline,
                            padding: theme.space.base, ...theme.shadow.card,
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.md }}>
                            <Text style={[theme.text('label'), { color: theme.color.text.tertiary }]}>Slide {i + 1}</Text>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Remove slide ${i + 1}`}
                              testID={`draft-remove-${slide.key}`}
                              hitSlop={8}
                              onPress={() => removeSlide(slide.key)}
                              style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
                            >
                              <Icon name="cross" size={18} color={theme.color.status.danger.text} />
                            </Pressable>
                          </View>
                          <Field accessibilityLabel={`Slide ${i + 1} title`} value={slide.title} onChangeText={(v) => updateSlide(slide.key, { title: v })} />
                          <Field
                            accessibilityLabel={`Slide ${i + 1} bullets, one per line`}
                            value={slide.bullets.join('\n')}
                            multiline
                            onChangeText={(v) => updateSlide(slide.key, { bullets: v.split('\n').map((b) => b.trim()).filter(Boolean) })}
                            style={{ minHeight: 88 }}
                          />
                          <Field accessibilityLabel={`Slide ${i + 1} speaker notes`} value={slide.notes} multiline onChangeText={(v) => updateSlide(slide.key, { notes: v })} />
                          <SourceRefs roomId={room.id} chunks={chunks} ids={slide.sourceChunkIds} />
                        </View>
                      ))
                      : null}
                    {saveError ? <Notice tone="danger" testID="study-save-error">{saveError}</Notice> : null}
                    <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]}>
                      Confirm saves the whole set at once. Cancel writes nothing.
                    </Text>
                    {!draftTitle.trim() ? (
                      <Text style={[theme.text('bodySmall'), { color: theme.color.text.tertiary }]} testID="study-title-hint">
                        Give the set a title to enable Confirm.
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.md }}>
                      <View style={{ flex: 1, minWidth: 160 }}>
                        <Button
                          label={saving ? 'Saving…' : saveError ? 'Retry save' : 'Confirm save'}
                          disabled={saving || itemCount === 0 || !draftTitle.trim()}
                          onPress={() => void confirm()}
                        />
                      </View>
                      <Button label="Cancel" variant="outline" onPress={closeSheet} />
                    </View>
                    <Button label="Discard draft" variant="ghost" onPress={closeSheet} />
                  </View>
                )}
              </ScrollView>
            </SafeAreaView>
          </Screen>
        </Modal>
      </SafeAreaView>
    </Screen>
  );
}
