import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { Badge, createStyles } from '../../../design-theme/src/primitives';
import type { Room } from '../../data/models';
import { chooseExistingRoom, destinationForMapping, matchingRooms, type RoomMapping } from '../../import/room-map';
import { ImportSteps } from './import-choose-files';
import { groupOf, isSettled, selectedReviewNote } from '../../import/review-selection';
import { RoomMappingControl } from './room-mapping';

export { groupOf, isSettled };

/** `same`: identical to what is stored. `changed`: same source path, different content. */
export type DuplicateState = 'same' | 'changed';

export interface ReviewNote {
  id: string;
  title: string;
  path: string;
  bodies: readonly string[];
  warnings: readonly string[];
  subjects: string;
  mapping: RoomMapping;
  skipped: boolean;
  done: boolean;
  duplicate?: DuplicateState;
  result?: string;
}

const GROUP_ORDER: readonly { key: 'imported' | 'needs' | 'ready' | 'skipped'; label: string }[] = [
  { key: 'needs', label: 'needs a room' },
  { key: 'ready', label: 'ready' },
  { key: 'imported', label: 'already imported' },
  { key: 'skipped', label: 'skipped' },
];

export function ImportReviewRooms({
  notes, rooms, busy, errors, onChangeMapping, onAssignAll, onSkip, onKeepBoth, onBack, onSave,
}: {
  notes: readonly ReviewNote[];
  rooms: readonly Room[];
  busy: boolean;
  errors: readonly string[];
  onChangeMapping(id: string, mapping: RoomMapping): void;
  /** Gives every note that still needs a room the same room. */
  onAssignAll(mapping: RoomMapping): void;
  onSkip(id: string, skipped: boolean): void;
  onKeepBoth(id: string): void;
  onBack(): void;
  onSave(): void;
}) {
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [declined, setDeclined] = useState<ReadonlySet<string>>(new Set());
  const selected = selectedReviewNote(notes, selectedId);
  if (selected && selected.id !== selectedId) setSelectedId(selected.id);

  const writable = notes.filter((n) => groupOf(n) === 'ready');
  const needs = notes.filter((n) => groupOf(n) === 'needs').length;
  const skipped = notes.filter((n) => n.skipped).length;
  const roomCount = new Set(writable.map((n) => {
    const d = destinationForMapping(n.mapping);
    return d && 'roomId' in d ? d.roomId : `new:${d && 'name' in d ? d.name.toLowerCase() : ''}`;
  })).size;
  const canSave = !busy && needs === 0 && writable.length > 0;
  const namedDestination = selected ? destinationForMapping(selected.mapping) : null;
  const sharedName = selected?.mapping.status === 'new' && namedDestination && 'name' in namedDestination ? namedDestination.name : '';
  const summary = `${writable.length} note${writable.length === 1 ? '' : 's'} into ${roomCount} room${roomCount === 1 ? '' : 's'}`
    + `${skipped ? ` · ${skipped} skipped` : ''}${needs ? ` · ${needs} needs a room before you can save` : ''}`;

  const suggestion = selected && !selected.done && !selected.skipped && selected.mapping.status === 'unset' && !declined.has(selected.id)
    ? matchingRooms(rooms, selected.subjects)[0]
    : undefined;

  return (
    <View style={styles.root} testID="import-review-rooms">
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text accessibilityRole="header" style={styles.title}>review and pick rooms</Text>
          <Text style={styles.meta}>suggest rooms and subjects from the files. nothing is saved until you confirm.</Text>
        </View>
        <ImportSteps current={2} />
      </View>

      {needs > 0 && rooms.length > 0 ? (
        <View style={styles.card} accessibilityLabel="room for every note">
          <Text style={styles.eyebrow}>{`PUT ${needs === 1 ? 'THE NOTE' : `ALL ${needs} NOTES`} THAT NEED A ROOM INTO`}</Text>
          <View style={styles.chips}>
            {rooms.map((room) => (
              <Pressable
                key={room.id} accessibilityRole="button" accessibilityLabel={`Put every note that needs a room into ${room.name}`}
                disabled={busy} onPress={() => onAssignAll(chooseExistingRoom(room.id))} style={[styles.chip, busy && styles.disabled]}
              >
                <Text style={styles.secondaryText} numberOfLines={1}>{room.name}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.meta}>notes that already have a room keep it. you can still change any single note below.</Text>
        </View>
      ) : null}

      <View style={[styles.cols, wide && styles.colsWide]}>
        <View style={[styles.card, wide && styles.listCol]} accessibilityLabel="notes">
          <Text style={styles.eyebrow}>{notes.length} NOTES</Text>
          {GROUP_ORDER.map(({ key, label }) => {
            const items = notes.filter((n) => groupOf(n) === key);
            if (!items.length) return null;
            return (
              <View key={key} style={styles.group}>
                <Text style={styles.groupLabel}>{label}</Text>
                {items.map((n) => {
                  const dest = destinationForMapping(n.mapping);
                  const roomName = dest && 'roomId' in dest ? rooms.find((r) => r.id === dest.roomId)?.name : dest?.name;
                  const on = selected?.id === n.id;
                  return (
                    <Pressable
                      key={n.id} accessibilityRole="button" accessibilityLabel={`Review ${n.title}`}
                      accessibilityState={{ selected: on }} onPress={() => setSelectedId(n.id)}
                      style={[styles.noteRow, on && styles.noteRowOn]}
                    >
                      <Text style={styles.noteTitle} numberOfLines={1}>{n.title}</Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {key === 'ready' && roomName ? `→ ${roomName}` : key === 'needs' ? `${n.bodies.length} chunks` : label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </View>

        {selected ? (
          <>
            <View style={[styles.card, wide && styles.previewCol]} accessibilityLabel="preview">
              <View style={styles.rowBetween}>
                <View style={styles.flex}>
                  <Text accessibilityRole="header" style={styles.heading}>{selected.title}</Text>
                  <Text style={styles.meta}>{selected.path} · {selected.bodies.length} chunks</Text>
                </View>
                {selected.done ? <Badge tone="success" label="imported" />
                  : selected.skipped ? <Badge tone="warning" label="skipped" />
                  : destinationForMapping(selected.mapping) ? <Badge tone="success" label="room chosen" />
                  : <Badge tone="danger" label="needs a room" />}
              </View>
              {selected.warnings.map((w) => <View key={w} style={styles.warn}><Text style={styles.warnText}>{w}</Text></View>)}
              <ScrollView style={styles.chunks} nestedScrollEnabled>
                {selected.bodies.map((body, i) => (
                  <View key={i} style={styles.chunk}>
                    <Text selectable style={styles.chunkText}>{body}</Text>
                    <Text style={styles.meta}>chunk {i + 1}</Text>
                  </View>
                ))}
              </ScrollView>
              {selected.subjects ? <Text style={styles.meta}>subjects · {selected.subjects}</Text> : null}
            </View>

            <View style={[styles.side, wide && styles.sideCol]}>
              {selected.duplicate ? (
                <View style={styles.card} accessibilityLabel="duplicate">
                  <Text style={styles.eyebrow}>YOU IMPORTED THIS NOTE BEFORE</Text>
                  <Text style={styles.body}>
                    {selected.duplicate === 'same'
                      ? 'this note is identical to the stored copy. nothing would change.'
                      : 'this note changed since the last import. your highlights and pinned answers on the stored chunks stay put.'}
                  </Text>
                  <Choice label="update the changed chunk" detail="not available yet" disabled onPress={() => undefined} />
                  <Choice label="keep both" detail="adds the new version as its own chunk" disabled={busy || selected.done} onPress={() => onKeepBoth(selected.id)} />
                  <Choice
                    label={selected.skipped ? 'skip this note (on)' : 'skip this note'}
                    selected={selected.skipped} disabled={busy || selected.done}
                    onPress={() => onSkip(selected.id, !selected.skipped)}
                  />
                </View>
              ) : null}

              {suggestion ? (
                <View style={styles.card} accessibilityLabel="companion suggestion">
                  <Text style={styles.eyebrow}>COMPANION SUGGESTS · FOR “{selected.title.toUpperCase()}”</Text>
                  <Text style={styles.body}>put it in {suggestion.name}. it only read the file&apos;s text.</Text>
                  <View style={styles.actions}>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Accept ${suggestion.name}`} onPress={() => onChangeMapping(selected.id, chooseExistingRoom(suggestion.id))} style={styles.primary}>
                      <Text style={styles.primaryText}>accept</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" accessibilityLabel="Not this" onPress={() => setDeclined(new Set(declined).add(selected.id))} style={styles.secondary}>
                      <Text style={styles.secondaryText}>not this</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {!selected.skipped && !selected.done && selected.duplicate !== 'same' ? (
                <RoomMappingControl
                  title={selected.title} subjects={selected.subjects} rooms={rooms} mapping={selected.mapping}
                  disabled={busy} onChange={(m) => onChangeMapping(selected.id, m)}
                />
              ) : null}
              {sharedName && needs > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${sharedName} for every note that needs a room`}
                  disabled={busy}
                  onPress={() => onAssignAll(selected.mapping)}
                  style={styles.secondary}
                >
                  <Text style={styles.secondaryText}>{`use "${sharedName}" for every note that needs a room`}</Text>
                </Pressable>
              ) : null}

              {!selected.duplicate && !selected.done ? (
                <Pressable
                  accessibilityRole="button" accessibilityLabel={selected.skipped ? `Include ${selected.title}` : `Skip ${selected.title}`}
                  disabled={busy} onPress={() => onSkip(selected.id, !selected.skipped)} style={styles.secondary}
                >
                  <Text style={styles.secondaryText}>{selected.skipped ? 'include this note' : 'skip this note'}</Text>
                </Pressable>
              ) : null}
              {selected.result ? <Text accessibilityLiveRegion="polite" style={selected.done ? styles.body : styles.error}>{selected.result}</Text> : null}
            </View>
          </>
        ) : null}
      </View>

      {errors.map((e, i) => <Text key={i} accessibilityRole="alert" style={styles.error}>{e}</Text>)}

      <View style={styles.bar}>
        <Text accessibilityLiveRegion="polite" style={[styles.barText, needs > 0 && styles.barWarn]}>{summary}</Text>
        <View style={styles.actions}>
          {busy ? <ActivityIndicator accessibilityLabel="Working on notes" /> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Back to files" disabled={busy} onPress={onBack} style={styles.secondary}>
            <Text style={styles.secondaryText}>back</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button" accessibilityLabel={`Save ${writable.length} notes`}
            accessibilityState={{ disabled: !canSave }} disabled={!canSave} onPress={onSave}
            style={[styles.primary, !canSave && styles.disabled]}
          >
            <Text style={styles.primaryText}>{`save ${writable.length} note${writable.length === 1 ? '' : 's'}`}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function Choice({ label, detail, selected = false, disabled, onPress }: { label: string; detail?: string; selected?: boolean; disabled: boolean; onPress(): void }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected, disabled }}
      disabled={disabled} onPress={onPress} style={[styles.choice, selected && styles.choiceOn, disabled && styles.disabled]}
    >
      <Text style={styles.noteTitle}>{label}</Text>
      {detail ? <Text style={styles.meta}>{detail}</Text> : null}
    </Pressable>
  );
}

const useStyles = createStyles((theme) => StyleSheet.create({
  root: { gap: 16, width: '100%' },
  header: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 },
  headerText: { gap: 4, flexShrink: 1 },
  title: { ...theme.text('screenTitle'), color: theme.color.text.primary },
  heading: { ...theme.text('title'), color: theme.color.text.primary },
  body: { ...theme.text('body'), color: theme.color.text.secondary },
  meta: { ...theme.text('bodySmall'), color: theme.color.text.tertiary },
  eyebrow: { ...theme.text('label'), letterSpacing: 0.8, color: theme.color.text.tertiary },
  cols: { gap: 12 },
  colsWide: { flexDirection: 'row', alignItems: 'flex-start' },
  listCol: { width: 240 },
  previewCol: { flex: 1 },
  sideCol: { width: 340 },
  side: { gap: 12 },
  flex: { flex: 1, gap: 2 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
  card: { backgroundColor: theme.color.bg.surface, padding: 16, gap: 10, borderRadius: 18, borderWidth: 1, borderColor: theme.color.border.hairline },
  group: { gap: 6 },
  groupLabel: { ...theme.text('label'), color: theme.color.text.secondary },
  noteRow: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border.hairline },
  noteRowOn: { borderWidth: 2, borderColor: theme.color.text.primary, paddingHorizontal: 11, paddingVertical: 7 },
  noteTitle: { ...theme.text('body'), fontWeight: '600', color: theme.color.text.primary },
  warn: { padding: 10, borderRadius: 10, backgroundColor: theme.color.bg.canvas },
  warnText: { ...theme.text('bodySmall'), color: theme.color.text.secondary },
  chunks: { maxHeight: 420 },
  chunk: { gap: 4, padding: 12, marginBottom: 8, borderRadius: 12, backgroundColor: theme.color.bg.canvas },
  chunkText: { ...theme.text('body'), color: theme.color.text.primary },
  choice: { minHeight: 48, justifyContent: 'center', gap: 2, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: theme.color.border.hairline },
  choiceOn: { borderWidth: 2, borderColor: theme.color.text.primary, paddingHorizontal: 11, paddingVertical: 7 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, maxWidth: 240, borderRadius: 12, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1, borderColor: theme.color.border.strong },
  primary: { minHeight: 44, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.color.accent.bg },
  primaryText: { ...theme.text('buttonCompact'), color: theme.color.accent.fg },
  secondary: { minHeight: 44, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.color.border.strong },
  secondaryText: { ...theme.text('buttonCompact'), color: theme.color.text.primary },
  bar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.color.border.hairline },
  barText: { ...theme.text('bodySmall'), color: theme.color.text.secondary, flexShrink: 1 },
  barWarn: { color: theme.color.status.danger.text },
  disabled: { opacity: 0.5 },
  error: { ...theme.text('bodySmall'), color: theme.color.status.danger.text },
}));
