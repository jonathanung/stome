import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { createStyles } from '../../../design-theme/src/primitives';

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

function Action({ label, onPress, disabled = false }: { label: string; onPress(): void; disabled?: boolean }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
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
  const [open, setOpen] = useState(false);
  const subject = roomNameFromSubject(subjects);
  const destination = destinationForMapping(mapping);
  const matches = matchingRooms(rooms, subjects);
  const matchIds = new Set(matches.map((room) => room.id));
  const ordered = [...matches, ...rooms.filter((room) => !matchIds.has(room.id))];
  const chosen = mapping.status === 'existing'
    ? rooms.find((room) => room.id === mapping.roomId)?.name ?? 'unavailable'
    : null;

  return (
    <View style={styles.section} testID={`room-mapping-${title}`}>
      <Text style={styles.label}>{subject ? `Map “${subject}” to a room` : 'Map this note to a room'}</Text>
      <Text style={styles.hint}>
        Choose an existing room or name a new one. Other subjects stay on the note. Importing does not change the stone stage.
      </Text>
      {matches.length > 0 && mapping.status === 'unset' ? (
        <Text style={styles.hint}>An existing room matches this subject. Choose it, or name a new room.</Text>
      ) : null}
      {mapping.status === 'existing' ? <Text style={styles.text}>Mapped to existing room {chosen}.</Text> : null}
      {mapping.status === 'new' && destination && 'name' in destination ? (
        <Text style={styles.text}>New room “{destination.name}” is created when you confirm.</Text>
      ) : null}
      {mapping.status === 'new' ? (
        <View style={styles.field}>
          <Text style={styles.label}>{`New room name for ${title}`}</Text>
          <TextInput
            accessibilityLabel={`New room name for ${title}`}
            value={mapping.name}
            onChangeText={(name) => onChange(chooseNewRoom(name))}
            editable={!disabled}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </View>
      ) : null}
      {open ? (
        <View style={styles.section}>
          {ordered.map((room) => (
            <Action
              key={room.id}
              label={`Use existing room ${room.name} for ${title}`}
              disabled={disabled}
              onPress={() => {
                onChange(chooseExistingRoom(room.id));
                setOpen(false);
              }}
            />
          ))}
          <Action
            label={`Name a new room for ${title}`}
            disabled={disabled}
            onPress={() => {
              onChange(chooseNewRoom(subject));
              setOpen(false);
            }}
          />
          <Action label={`Cancel room choice for ${title}`} disabled={disabled} onPress={() => setOpen(false)} />
        </View>
      ) : (
        <Action
          label={mapping.status === 'unset' ? `Choose a room for ${title}` : `Change room for ${title}`}
          disabled={disabled}
          onPress={() => setOpen(true)}
        />
      )}
      {mapping.status !== 'unset' && !open ? (
        <Action label={`Clear room choice for ${title}`} disabled={disabled} onPress={() => onChange(cancelRoomMapping())} />
      ) : null}
      {!destination ? <Text style={styles.hint}>Nothing is saved until you choose a room and confirm.</Text> : null}
    </View>
  );
}

const useStyles = createStyles((theme) => StyleSheet.create({
  section: { gap: 12 },
  text: { ...theme.text('body'), color: theme.color.text.secondary },
  hint: { ...theme.text('bodySmall'), color: theme.color.text.tertiary },
  label: { ...theme.text('buttonCompact'), color: theme.color.text.secondary, },
  field: { gap: 6 },
  input: { ...theme.text('body'),
    minHeight: 48,
    borderWidth: 1,
    borderColor: theme.color.border.strong,
    borderRadius: 10,
    padding: 12,
    color: theme.color.text.primary,
    backgroundColor: theme.color.bg.inset,
  },
  button: {
    minHeight: 48,
    borderRadius: 12,
    padding: 12,
    backgroundColor: theme.color.accent.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: { ...theme.text('buttonCompact'), color: theme.color.accent.fg },
  disabled: { opacity: 0.5 },
}));
