import type { ComponentRef, Ref } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import { Icon } from '../../ui/Icon';
import { Notice } from '../../ui/kit';

/** Phone layout of quick capture: a bottom sheet over a scrim. Width below this uses the sheet. */
export const CAPTURE_SHEET_MAX_WIDTH = 600;

export type QuickCaptureSheetProps = {
  text: string;
  onChangeText: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
  ready: boolean;
  failed: boolean;
  roomName: string | null;
  needsRoom: boolean;
  createRoomLink: React.ReactNode;
  error: string | null;
  warning: string | null;
  inputRef: Ref<ComponentRef<typeof TextInput>>;
};

export function QuickCaptureSheet(props: QuickCaptureSheetProps) {
  const { text, onChangeText, onSave, onClose, ready, failed, roomName, createRoomLink, error, warning, inputRef } = props;
  const theme = useStoneTheme();
  const fixed = (Platform.OS === 'web' ? 'fixed' : 'absolute') as 'absolute';
  return (
    <View pointerEvents="box-none" style={{ position: fixed, top: 0, left: 0, right: 0, bottom: 0, zIndex: 40, justifyContent: 'flex-end' }} testID="quick-capture-sheet-layer">
      <Pressable
        accessibilityLabel="Close quick capture"
        accessibilityRole="button"
        onPress={onClose}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(36, 34, 30, 0.4)' }}
        testID="quick-capture-scrim"
      />
      <View
        accessibilityViewIsModal
        style={{
          backgroundColor: theme.color.bg.surface,
          borderTopLeftRadius: theme.radius.panel,
          borderTopRightRadius: theme.radius.panel,
          paddingTop: 10,
          paddingHorizontal: theme.space.base,
          paddingBottom: 34,
          gap: 14,
          ...theme.shadow.float,
        }}
        testID="quick-capture-panel"
      >
        <View style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: theme.color.bg.inset }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.space.md }}>
          <Text accessibilityRole="header" style={[theme.text('title'), { color: theme.color.text.primary }]}>quick capture</Text>
          {roomName ? (
            <View
              style={{
                minHeight: 36,
                paddingHorizontal: 12,
                borderRadius: theme.radius.pill,
                borderWidth: 1,
                borderColor: theme.color.border.strong,
                justifyContent: 'center',
                flexShrink: 1,
              }}
              testID="quick-capture-room"
            >
              <Text numberOfLines={1} style={[theme.text('chip'), { color: theme.color.text.primary }]}>{roomName}</Text>
            </View>
          ) : null}
        </View>
        <View style={{ gap: 10 }}>
          <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>ONE LINE FOR THIS ROOM</Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space.md,
              paddingTop: 4,
              paddingRight: 4,
              paddingBottom: 4,
              paddingLeft: 14,
              borderRadius: theme.radius.lg,
              borderWidth: 1.5,
              borderColor: theme.color.text.primary,
              backgroundColor: theme.color.bg.canvas,
            }}
          >
            <TextInput
              accessibilityLabel="Quick capture note"
              autoCapitalize="sentences"
              onChangeText={onChangeText}
              onSubmitEditing={onSave}
              placeholder="one line for this room"
              placeholderTextColor={theme.color.text.tertiary}
              ref={inputRef}
              returnKeyType="done"
              style={[
                theme.text('body'),
                { flex: 1, minWidth: 0, minHeight: 44, fontSize: 16, lineHeight: 22, color: theme.color.text.primary },
                Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
              ]}
              testID="quick-capture-input"
              value={text}
            />
            <Pressable
              accessibilityLabel={failed ? 'Retry capture' : 'Save capture'}
              accessibilityRole="button"
              accessibilityState={{ disabled: !ready }}
              disabled={!ready}
              onPress={onSave}
              style={{
                width: 44,
                height: 44,
                borderRadius: theme.radius.control,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: ready ? theme.color.accent.bg : theme.color.bg.inset,
              }}
              testID={failed ? 'quick-capture-retry' : 'quick-capture-save'}
            >
              <Icon name={failed ? 'refresh' : 'check'} size={18} strokeWidth={2.5} color={ready ? theme.color.accent.fg : theme.color.text.disabled} />
            </Pressable>
          </View>
          <Text style={[theme.text('caption'), { color: theme.color.text.tertiary }]}>
            {Platform.OS === 'web' ? 'kept as a draft if you close this. enter saves.' : 'enter saves.'}
          </Text>
        </View>
        {createRoomLink}
        {error ? <Notice tone="danger" testID="quick-capture-error">{error}</Notice> : null}
        {warning ? <Notice tone="warning" testID="quick-capture-warning">{warning}</Notice> : null}
      </View>
    </View>
  );
}
