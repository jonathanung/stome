import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import { Icon } from '../../ui/Icon';

export type AskMessage = { id: string; text: string; note?: string };

export type ProposedAnswer = {
  answer: string;
  /** 1-based source numbers shown as badges after the answer. */
  citations?: readonly number[];
};

export type RoomAskPanelProps = {
  /** e.g. "your ink + 2 chunks". */
  subtitle: string;
  /** e.g. "Anthropic · claude-opus-5-5 · live". Null while the companion is unknown. */
  providerLabel?: string | null;
  messages: readonly AskMessage[];
  proposal: ProposedAnswer | null;
  onSend: (text: string) => void;
  onPin: () => void;
  onDecline: () => void;
  onClose: () => void;
};

/** Width of the ask column in the iPad split view. */
export const ASK_PANEL_WIDTH = 420;

export function SourceBadge({ n }: { n: number }) {
  const theme = useStoneTheme();
  return (
    <Text style={[theme.text('eyebrow'), {
      color: theme.color.text.onFill, backgroundColor: theme.color.status.success.fill,
      letterSpacing: 0, fontSize: 11, lineHeight: 18,
    }]}>{` ${n} `}</Text>
  );
}

/** The right-hand "ask" column of the iPad room split view. */
export function RoomAskPanel({ subtitle, providerLabel, messages, proposal, onSend, onPin, onDecline, onClose }: RoomAskPanelProps) {
  const theme = useStoneTheme();
  const [draft, setDraft] = useState('');
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };
  const control = theme.layout.control;
  return (
    <View accessibilityLabel="ask" testID="room-ask-panel" style={{
      width: ASK_PANEL_WIDTH, backgroundColor: theme.color.bg.surface,
      borderLeftWidth: 1, borderLeftColor: theme.color.border.hairline,
    }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: theme.space.card, paddingTop: theme.space.section, paddingBottom: theme.space.xxl,
        borderBottomWidth: 1, borderBottomColor: theme.color.border.hairline,
      }}>
        <View>
          <Text accessibilityRole="header" style={[theme.text('actionTitle'), { color: theme.color.text.primary }]}>ask</Text>
          <Text style={[theme.text('meta'), { color: theme.color.text.tertiary }]}>{subtitle}</Text>
          {providerLabel ? <Text testID="room-ask-provider" style={[theme.text('meta'), { color: theme.color.text.tertiary }]}>{providerLabel}</Text> : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="close ask panel" onPress={onClose}
          style={{ width: control, height: control, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="cross" size={18} />
        </Pressable>
      </View>
      <View style={{ flex: 1, padding: theme.space.card, gap: theme.space.xxl }}>
        {messages.map((message) => (
          <View key={message.id} style={{
            alignSelf: 'flex-end', maxWidth: '88%', backgroundColor: theme.color.accent.bg,
            paddingHorizontal: theme.space.xxl, paddingVertical: theme.space.lg,
            borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomLeftRadius: 16, borderBottomRightRadius: 4,
          }}>
            <Text style={[theme.text('ask'), { color: theme.color.accent.fg }]}>
              {message.text}
              {message.note ? <Text style={{ opacity: 0.7 }}>{` (${message.note})`}</Text> : null}
            </Text>
          </View>
        ))}
        {proposal ? (
          <View accessibilityLabel="proposed ai answer" style={{
            borderWidth: 1.5, borderColor: theme.color.border.strong, borderRadius: theme.radius.float,
            backgroundColor: theme.color.bg.canvas, padding: theme.space.base, gap: theme.space.xl,
          }}>
            <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>PROPOSED AI ANSWER</Text>
            <Text style={[theme.text('ask'), { lineHeight: 23, color: theme.color.text.primary }]}>
              {proposal.answer}
              {proposal.citations?.map((n) => <SourceBadge key={n} n={n} />)}
            </Text>
            <View style={{ flexDirection: 'row', gap: theme.space.md }}>
              <Pressable accessibilityRole="button" onPress={onPin} style={{
                flex: 1, minHeight: control, borderRadius: theme.radius.lg,
                alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.accent.bg,
              }}>
                <Text style={[theme.text('buttonCompact'), { color: theme.color.accent.fg }]}>pin on my ink</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={onDecline} style={{
                minHeight: control, borderRadius: theme.radius.lg, paddingHorizontal: theme.space.base,
                alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.color.border.strong,
              }}>
                <Text style={[theme.text('buttonCompact'), { color: theme.color.text.primary }]}>decline</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: theme.space.md,
        marginHorizontal: theme.space.base, marginBottom: theme.space.card,
        paddingVertical: theme.space.sm, paddingRight: theme.space.sm, paddingLeft: theme.space.xxl,
        borderRadius: theme.radius.bubble, backgroundColor: theme.color.bg.canvas,
        borderWidth: 1, borderColor: theme.color.border.strong,
      }}>
        <TextInput accessibilityLabel="follow-up question" placeholder="type or write a follow-up"
          placeholderTextColor={theme.color.text.tertiary} value={draft} onChangeText={setDraft}
          onSubmitEditing={send} returnKeyType="send"
          style={[theme.text('ask'), { flex: 1, minHeight: control, color: theme.color.text.primary }]} />
        <Pressable accessibilityRole="button" accessibilityLabel="dictate"
          style={{ width: control, height: control, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={theme.color.text.secondary} strokeWidth={1.75} strokeLinecap="round">
            <Rect x="9" y="3" width="6" height="11" rx="3" /><Path d="M5 11a7 7 0 0 0 14 0" />
          </Svg>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="send" onPress={send} style={{
          width: control, height: control, borderRadius: theme.radius.control,
          alignItems: 'center', justifyContent: 'center', backgroundColor: theme.color.accent.bg,
        }}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={theme.color.accent.fg} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M12 19V5" /><Path d="m5 12 7-7 7 7" />
          </Svg>
        </Pressable>
      </View>
    </View>
  );
}
