import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { createStyles, useStoneTheme } from '../../../design-theme/src/primitives';

import {
  cancelRoomMapping,
  chooseExistingRoom,
  chooseNewRoom,
  destinationForMapping,
  matchingRooms,
  roomNameFromSubject,
  type ExistingRoom,
  type RoomMapping,
} from '../../import/room-map';

function Option({ label, detail, selected, disabled, onPress, children }: {
  label: string;
  detail?: string;
  selected: boolean;
  disabled: boolean;
  onPress(): void;
  children?: ReactNode;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.opt, selected && styles.optOn, disabled && styles.disabled]}
    >
      <View style={[styles.radio, selected && styles.radioOn]} />
      <View style={styles.optBody}>
        <Text style={styles.optText}>
          <Text style={styles.optStrong}>{label}</Text>
          {detail ? <Text style={styles.meta}>{` · ${detail}`}</Text> : null}
        </Text>
        {children}
      </View>
    </Pressable>
  );
}

export function RoomMappingControl({
  title,
  subjects,
  rooms,
  mapping,
  disabled = false,
  onChange,
}: {
  title: string;
  subjects: string;
  rooms: readonly ExistingRoom[];
  mapping: RoomMapping;
  disabled?: boolean;
  onChange(mapping: RoomMapping): void;
}) {
  const styles = useStyles();
  const theme = useStoneTheme();
  const subject = roomNameFromSubject(subjects);
  const destination = destinationForMapping(mapping);
  const matches = matchingRooms(rooms, subjects);
  const matchIds = new Set(matches.map((room) => room.id));
  const ordered = [...matches, ...rooms.filter((room) => !matchIds.has(room.id))];

  return (
    <View style={styles.box} accessibilityRole="radiogroup" testID={`room-mapping-${title}`}>
      <Text style={styles.eyebrow}>{subject ? `ROOM FOR SUBJECT “${subject.toUpperCase()}”` : 'ROOM FOR THIS NOTE'}</Text>
      <Text style={styles.hint}>
        {matches.length > 0
          ? 'An existing room matches this subject. Choose it, or name a new room.'
          : 'Choose an existing room or name a new one. Other subjects stay on the note. Importing does not change the stone stage.'}
      </Text>
      {ordered.map((room) => (
        <Option
          key={room.id}
          label={room.name}
          detail={matchIds.has(room.id) ? 'matches subject' : undefined}
          selected={mapping.status === 'existing' && mapping.roomId === room.id}
          disabled={disabled}
          onPress={() => onChange(chooseExistingRoom(room.id))}
        />
      ))}
      <Option
        label="New room"
        selected={mapping.status === 'new'}
        disabled={disabled}
        onPress={() => { if (mapping.status !== 'new') onChange(chooseNewRoom(subject)); }}
      >
        <TextInput
          accessibilityLabel={`New room name for ${title}`}
          placeholder="room name"
          placeholderTextColor={theme.color.text.disabled}
          value={mapping.status === 'new' ? mapping.name : ''}
          onFocus={() => { if (mapping.status !== 'new') onChange(chooseNewRoom(subject)); }}
          onChangeText={(name) => onChange(chooseNewRoom(name))}
          editable={!disabled}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
      </Option>
      {mapping.status === 'new' && destination && 'name' in destination ? (
        <Text style={styles.hint}>New room “{destination.name}” is created when you confirm.</Text>
      ) : null}
      {mapping.status !== 'unset' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Clear room choice for ${title}`}
          disabled={disabled}
          onPress={() => onChange(cancelRoomMapping())}
          style={styles.clear}
        >
          <Text style={styles.clearText}>Clear choice</Text>
        </Pressable>
      ) : null}
      {!destination ? <Text style={styles.hint}>Nothing is saved until you choose a room and confirm.</Text> : null}
    </View>
  );
}

const useStyles = createStyles((theme) => StyleSheet.create({
  box: { gap: 10, padding: 14, borderRadius: 18, backgroundColor: theme.color.bg.canvas },
  eyebrow: { ...theme.text('label'), letterSpacing: 0.8, color: theme.color.text.tertiary },
  hint: { ...theme.text('bodySmall'), color: theme.color.text.secondary },
  meta: { ...theme.text('bodySmall'), color: theme.color.text.tertiary },
  opt: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 48,
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12,
    borderWidth: 1, borderColor: theme.color.border.hairline, backgroundColor: theme.color.bg.surface,
  },
  optOn: { borderWidth: 2, borderColor: theme.color.text.primary, paddingVertical: 9, paddingHorizontal: 11 },
  optBody: { flex: 1, gap: 6 },
  optText: { ...theme.text('body'), color: theme.color.text.primary },
  optStrong: { fontWeight: '600' },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: theme.color.border.strong, marginTop: 1 },
  radioOn: { borderWidth: 5, borderColor: theme.color.accent.bg },
  input: {
    ...theme.text('bodySmall'), minHeight: 36, borderRadius: 10, borderWidth: 1,
    borderColor: theme.color.border.hairline, backgroundColor: theme.color.bg.canvas,
    paddingHorizontal: 10, color: theme.color.text.primary,
  },
  clear: { minHeight: 36, justifyContent: 'center', alignSelf: 'flex-start' },
  clearText: { ...theme.text('buttonCompact'), color: theme.color.text.secondary },
  disabled: { opacity: 0.5 },
}));
