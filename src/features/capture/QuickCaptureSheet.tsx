import type { ComponentRef, Ref } from 'react';
import { useEffect, useRef } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View, type ScrollViewInstance } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import { Icon } from '../../ui/Icon';
import { Notice } from '../../ui/kit';
import { useCaptureKeyboardOverlap } from './use-capture-keyboard-inset';

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
  /** Newest-first notes already saved to this room, shown under the input. */
  recent?: { id: string; content: string; createdAt: number }[];
};

/** Capture modes in the design. Only typing is wired; the rest show as unavailable rather than pretending. */
const MODES = [
  { key: 'type', label: 'type', icon: 'note', available: true },
  { key: 'dictate', label: 'dictate', icon: 'spark', available: false },
  { key: 'pencil', label: 'pencil', icon: 'pen', available: false },
  { key: 'photo', label: 'photo', icon: 'upload', available: false },
] as const;

function clock(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function QuickCaptureSheet(props: QuickCaptureSheetProps) {
  const { text, onChangeText, onSave, onClose, ready, failed, roomName, createRoomLink, error, warning, inputRef, recent = [] } = props;
  const theme = useStoneTheme();
  const { overlap, layerRef, onLayerLayout } = useCaptureKeyboardOverlap();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const hasCreateRoomLink = createRoomLink != null;
  // Keep the save row, notices, and create-room link in reach when the
  // keyboard leaves less than the sheet's height. A short sheet stays put.
  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, [overlap, error, warning, hasCreateRoomLink]);

  return (
    <Modal
      animationType="none"
      navigationBarTranslucent
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible
    >
      <View
        onLayout={onLayerLayout}
        pointerEvents="box-none"
        ref={layerRef}
        style={{ flex: 1, paddingBottom: overlap }}
        testID="quick-capture-sheet-layer"
      >
        <ScrollView
          bounces={false}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => { scrollRef.current?.scrollToEnd({ animated: false }); }}
          ref={scrollRef}
          style={{ flex: 1 }}
        >
          <Pressable
            accessibilityLabel="Close quick capture"
            accessibilityRole="button"
            onPress={onClose}
            style={{ flexGrow: 1, backgroundColor: 'rgba(36, 34, 30, 0.4)' }}
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
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text numberOfLines={1} style={[theme.text('chip'), { color: theme.color.text.primary, flexShrink: 1 }]}>{roomName}</Text>
                <Icon name="chevronRight" size={12} strokeWidth={2} color={theme.color.text.tertiary} />
              </View>
            </View>
          ) : null}
        </View>
        <View style={{ gap: 10 }}>
          <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>one line for this room</Text>
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
              multiline
              blurOnSubmit
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
          <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: theme.space.md }} testID="quick-capture-modes">
            {MODES.map((mode) => (
              <View
                accessibilityLabel={mode.available ? mode.label : `${mode.label}, not available yet`}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode.available, disabled: !mode.available }}
                key={mode.key}
                style={{
                  flex: 1,
                  minHeight: 44,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  borderRadius: theme.radius.control,
                  borderWidth: 1,
                  borderColor: mode.available ? theme.color.text.primary : theme.color.border.hairline,
                  backgroundColor: mode.available ? theme.color.bg.surface : theme.color.bg.inset,
                  opacity: mode.available ? 1 : 0.6,
                }}
                testID={`quick-capture-mode-${mode.key}`}
              >
                <Icon name={mode.icon} size={16} color={theme.color.text.primary} />
                <Text style={[theme.text('chip'), { color: theme.color.text.primary }]}>{mode.label}</Text>
              </View>
            ))}
          </View>
          <Text style={[theme.text('caption'), { color: theme.color.text.tertiary }]}>
            kept as a draft if you close this. enter saves, shift enter adds a line.
          </Text>
        </View>
        {recent.length > 0 ? (
          <View style={{ gap: 8 }} testID="quick-capture-recent">
            <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>captured in this room</Text>
            {recent.map((item) => (
              <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
                <Text style={[theme.text('caption'), { color: theme.color.text.tertiary }]}>{clock(item.createdAt)}</Text>
                <Text numberOfLines={1} style={[theme.text('bodySmall'), { flex: 1, color: theme.color.text.primary }]}>{item.content}</Text>
                <Text style={[theme.text('caption'), { color: theme.color.text.tertiary }]}>saved</Text>
              </View>
            ))}
          </View>
        ) : null}
        {createRoomLink}
        {error ? <Notice tone="danger" testID="quick-capture-error">{error}</Notice> : null}
        {warning ? <Notice tone="warning" testID="quick-capture-warning">{warning}</Notice> : null}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
