import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import Svg, { Path, Rect } from 'react-native-svg';

import { createStyles, useStoneTheme } from '../../../design-theme/src/primitives';
import { Icon } from '../../ui/Icon';
import type { ChunkFocus } from './citations';

export type AskSheetSource = {
  chunkId: string;
  label: string;
  quote: string | null;
  anchorStart: number;
  anchorEnd: number;
};

export type AskSheetProps = {
  visible: boolean;
  /** Chunk labels the question includes. Shown as chips under the title. */
  included: readonly string[];
  /** The question that produced the proposal. */
  question: string | null;
  /** Null while nothing is waiting for a decision. */
  proposal: { kind: 'answer' | 'edit'; body: string; previousBody?: string } | null;
  sources: readonly AskSheetSource[];
  problems: readonly string[];
  busy: boolean;
  error: string | null;
  canConfirm: boolean;
  onClose: () => void;
  onAdd: () => void;
  onConfirm: () => void;
  onDecline: () => void;
  onOpenSource: (focus: ChunkFocus) => void;
  onFollowUp: (text: string) => void;
};

const SHEET_TOP = 96;

/**
 * Phone ask sheet (design 22): a modal sheet that holds the question, the
 * proposed AI answer (never saved until confirmed), its sources, and a
 * follow-up field. Presentational: HarnessPanel owns the data and actions.
 */
export function AskSheetPhone(props: AskSheetProps) {
  const styles = useStyles();
  const theme = useStoneTheme();
  const [text, setText] = useState('');
  const { proposal } = props;
  const isEdit = proposal?.kind === 'edit';
  const canSend = text.trim().length > 0 && !props.busy;

  function send() {
    if (!canSend) return;
    props.onFollowUp(text.trim());
    setText('');
  }

  return (
    <Modal animationType="slide" onRequestClose={props.onClose} transparent visible={props.visible}>
      <View style={styles.scrim}>
        <Pressable accessibilityLabel="Close ask" onPress={props.onClose} style={{ height: SHEET_TOP }} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheet}
          testID="ask-sheet"
        >
          <View accessibilityElementsHidden importantForAccessibility="no" style={styles.grabber} />
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text accessibilityRole="header" style={styles.title}>ask</Text>
              <Pressable accessibilityRole="button" onPress={props.onClose} style={styles.done} testID="ask-sheet-done">
                <Text style={styles.doneText}>done</Text>
              </Pressable>
            </View>
            <ScrollView
              accessibilityLabel="Included"
              contentContainerStyle={styles.chips}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {props.included.map((label, index) => (
                <View key={`${index}-${label}`} style={styles.chip}>
                  <Text numberOfLines={1} style={styles.chipText}>
                    {index === 0 ? `"${label}"` : `+ ${label}`}
                  </Text>
                </View>
              ))}
              <Pressable accessibilityRole="button" onPress={props.onAdd} style={[styles.chip, styles.chipAdd]} testID="ask-sheet-add">
                <Text style={styles.chipText}>+ add</Text>
              </Pressable>
            </ScrollView>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" style={{ flex: 1 }}>
            {props.question ? (
              <View style={styles.userBubble}>
                <Text style={styles.userText}>{props.question}</Text>
              </View>
            ) : null}
            {proposal ? (
              <>
                <View accessibilityLabel={isEdit ? 'proposed ai edit' : 'proposed ai answer'} style={styles.card} testID="ask-sheet-proposal">
                  <View style={styles.cardHead}>
                    <Text style={styles.eyebrow}>{isEdit ? 'PROPOSED AI EDIT' : 'PROPOSED AI ANSWER'}</Text>
                    <View style={styles.badge}><Text style={styles.badgeText}>not saved</Text></View>
                  </View>
                  {isEdit && proposal.previousBody !== undefined ? (
                    <Text style={[styles.answer, { color: theme.color.text.tertiary }]}>{proposal.previousBody}</Text>
                  ) : null}
                  <Text style={styles.answer}>{proposal.body}</Text>
                  {props.sources.map((source, index) => (
                    <Pressable
                      accessibilityLabel={source.quote ? `Show cited passage in ${source.label}` : `Show source chunk ${source.label}`}
                      accessibilityRole="button"
                      key={source.chunkId}
                      onPress={() => {
                        props.onOpenSource({ chunkId: source.chunkId, start: source.anchorStart, end: source.anchorEnd });
                        props.onClose();
                      }}
                      style={styles.source}
                      testID={`ask-sheet-source-${source.chunkId}`}
                    >
                      <View style={styles.sup}><Text style={styles.supText}>{index + 1}</Text></View>
                      <Text style={styles.sourceText}>
                        {source.quote ? `${source.label} · "${source.quote}"` : source.label}
                      </Text>
                    </Pressable>
                  ))}
                  {props.problems.map((problem) => (
                    <Text accessibilityRole="alert" key={problem} style={styles.error}>{problem}</Text>
                  ))}
                </View>
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !props.canConfirm || props.busy }}
                    disabled={!props.canConfirm || props.busy}
                    onPress={props.onConfirm}
                    style={[styles.confirm, !props.canConfirm || props.busy ? styles.disabled : null]}
                    testID="ask-sheet-confirm"
                  >
                    <Text style={styles.confirmText}>{isEdit ? 'confirm and save' : 'confirm and pin'}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={props.busy}
                    onPress={props.onDecline}
                    style={[styles.decline, props.busy ? styles.disabled : null]}
                    testID="ask-sheet-decline"
                  >
                    <Text style={styles.declineText}>{isEdit ? 'discard' : 'decline'}</Text>
                  </Pressable>
                </View>
                <Text style={styles.sub}>
                  {isEdit
                    ? 'discard leaves your chunks unchanged. confirm replaces the whole note.'
                    : 'decline writes nothing. pinned answers come back in review.'}
                </Text>
              </>
            ) : props.busy ? (
              <Text style={styles.sub}>asking…</Text>
            ) : null}
            {props.error ? <Text accessibilityRole="alert" style={styles.error} testID="ask-sheet-error">{props.error}</Text> : null}
          </ScrollView>

          <View style={styles.composer}>
            <TextInput
              accessibilityLabel="Ask a follow-up"
              onChangeText={setText}
              onSubmitEditing={send}
              placeholder="ask a follow-up"
              placeholderTextColor={theme.color.text.tertiary}
              returnKeyType="send"
              style={styles.input}
              testID="ask-sheet-input"
              value={text}
            />
            <Pressable accessibilityLabel="dictate" accessibilityRole="button" style={styles.dictate} testID="ask-sheet-dictate">
              <Svg fill="none" height={20} stroke={theme.color.text.secondary} strokeLinecap="round" strokeWidth={1.75} viewBox="0 0 24 24" width={20}>
                <Rect height={11} rx={3} width={6} x={9} y={3} />
                <Path d="M5 11a7 7 0 0 0 14 0" />
                <Path d="M12 18v3" />
              </Svg>
            </Pressable>
            <Pressable
              accessibilityLabel="Send"
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSend }}
              disabled={!canSend}
              onPress={send}
              style={[styles.send, !canSend ? styles.disabled : null]}
              testID="ask-sheet-send"
            >
              <Icon color={theme.color.accent.fg} name="arrowUp" size={18} strokeWidth={2} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const useStyles = createStyles((theme) => ({
  scrim: { flex: 1, backgroundColor: 'rgba(36, 34, 30, 0.4)' },
  sheet: {
    flex: 1,
    backgroundColor: theme.color.bg.canvas,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    ...theme.shadow.float,
  },
  grabber: {
    alignSelf: 'center' as const,
    width: 40,
    height: 5,
    borderRadius: 3,
    marginTop: 8,
    backgroundColor: theme.color.border.strong,
  },
  header: {
    paddingTop: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border.hairline,
  },
  titleRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  title: { ...theme.text('title'), color: theme.color.text.primary },
  done: { minHeight: theme.layout.control, paddingHorizontal: 8, justifyContent: 'center' as const },
  doneText: { ...theme.text('buttonCompact'), color: theme.color.text.primary },
  chips: { gap: 6 },
  chip: {
    minHeight: theme.layout.chip,
    paddingHorizontal: 12,
    borderRadius: 999,
    justifyContent: 'center' as const,
    backgroundColor: theme.color.bg.inset,
    maxWidth: 240,
  },
  chipAdd: { backgroundColor: 'transparent', borderWidth: 1, borderStyle: 'dashed' as const, borderColor: theme.color.border.strong },
  chipText: { ...theme.text('chip'), color: theme.color.text.secondary },
  body: { padding: 16, gap: 12 },
  userBubble: {
    alignSelf: 'flex-end' as const,
    maxWidth: '85%',
    backgroundColor: theme.color.accent.bg,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 4,
  },
  userText: { ...theme.text('ask'), color: theme.color.accent.fg },
  card: {
    borderWidth: 1.5,
    borderColor: theme.color.border.strong,
    borderRadius: 20,
    backgroundColor: theme.color.bg.surface,
    padding: 14,
    gap: 10,
  },
  cardHead: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  eyebrow: { ...theme.text('eyebrow'), color: theme.color.text.tertiary },
  badge: {
    backgroundColor: theme.color.status.warning.wash,
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  badgeText: { ...theme.text('fine'), fontFamily: theme.text('label').fontFamily, color: theme.color.status.warning.text },
  answer: { ...theme.text('bodySmall'), lineHeight: 23, color: theme.color.text.primary },
  source: {
    flexDirection: 'row' as const,
    gap: 10,
    alignItems: 'flex-start' as const,
    minHeight: theme.layout.control,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: theme.color.bg.canvas,
  },
  sourceText: { ...theme.text('caption'), flex: 1, color: theme.color.text.primary },
  sup: {
    minWidth: 18,
    height: 18,
    borderRadius: 5,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: theme.color.status.success.fill,
  },
  supText: { fontFamily: theme.text('buttonCompact').fontFamily, fontSize: 11, color: theme.color.text.onFill },
  actions: { flexDirection: 'row' as const, gap: 8 },
  confirm: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: theme.color.accent.bg,
  },
  confirmText: { ...theme.text('button'), fontSize: 16, color: theme.color.accent.fg },
  decline: {
    minHeight: 52,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.color.border.strong,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  declineText: { ...theme.text('button'), fontSize: 16, color: theme.color.text.primary },
  disabled: { opacity: 0.45 },
  sub: { ...theme.text('caption'), color: theme.color.text.tertiary },
  error: { ...theme.text('bodySmall'), color: theme.color.status.danger.text },
  composer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginHorizontal: 12,
    marginBottom: 34,
    paddingVertical: 4,
    paddingLeft: 14,
    paddingRight: 4,
    borderRadius: 18,
    backgroundColor: theme.color.bg.surface,
    borderWidth: 1,
    borderColor: theme.color.border.strong,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: theme.layout.control,
    ...theme.text('bodySmall'),
    fontSize: 16,
    color: theme.color.text.primary,
  },
  dictate: { width: 44, height: 44, alignItems: 'center' as const, justifyContent: 'center' as const },
  send: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: theme.color.accent.bg,
  },
}));
