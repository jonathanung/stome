import Svg, { Path } from 'react-native-svg';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import type { EditProposal } from '../../harness/contract';
import { countChanges, diffWords, type DiffPart } from './edit-diff';

const SPLIT_WIDTH = 900;

function DiffBody({ parts, tone }: { parts: DiffPart[]; tone: 'removed' | 'added' }) {
  const theme = useStoneTheme();
  const status = tone === 'removed' ? theme.color.status.danger : theme.color.status.success;
  return (
    <Text style={[theme.text('reading'), { color: theme.color.text.primary }]}>
      {parts.map((part, index) =>
        part.changed ? (
          <Text
            key={index}
            style={{
              backgroundColor: status.wash,
              color: status.text,
              textDecorationLine: tone === 'removed' ? 'line-through' : 'none',
            }}
          >
            {part.text}
          </Text>
        ) : (
          part.text
        ),
      )}
    </Text>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  primary,
  testID,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  primary?: boolean;
  testID: string;
  accessibilityLabel?: string;
}) {
  const theme = useStoneTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: theme.layout.control,
        paddingHorizontal: theme.layout.buttonCompactPadX,
        borderRadius: theme.radius.lg,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: primary ? theme.color.accent.bg : 'transparent',
        borderWidth: primary ? 0 : 1,
        borderColor: theme.color.border.strong,
        opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
      })}
    >
      <Text style={[theme.text('buttonCompact'), { color: primary ? theme.color.accent.fg : theme.color.text.primary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Before/after approval view for an AI-proposed whole-note edit. Nothing is saved until confirmed. */
export function EditProposalReview({
  proposal,
  title,
  confirmDisabled,
  busy,
  onConfirm,
  onDiscard,
}: {
  proposal: EditProposal;
  title: string;
  confirmDisabled: boolean;
  busy: boolean;
  onConfirm: () => void;
  onDiscard: () => void;
}) {
  const theme = useStoneTheme();
  const { width } = useWindowDimensions();
  const split = width > SPLIT_WIDTH;
  const diff = diffWords(proposal.previousBody, proposal.body);
  const changes = Math.max(countChanges(diff.before), countChanges(diff.after));
  const warning = theme.color.status.warning;
  const pane = { flex: split ? 1 : undefined, padding: theme.space.card, gap: theme.space.xl, minWidth: 0 } as const;

  return (
    <View
      testID="proposal-card"
      style={{
        marginTop: theme.space.xl,
        backgroundColor: theme.color.bg.surface,
        borderRadius: theme.radius.card,
        borderWidth: 1,
        borderColor: theme.color.border.hairline,
        overflow: 'hidden',
        ...theme.shadow.card,
      }}
    >
      <View style={{ paddingHorizontal: theme.space.section, paddingVertical: theme.space.xxl, gap: theme.space.md }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.xl }}>
          <Text accessibilityRole="header" style={[theme.text('title'), { color: theme.color.text.primary }]}>
            Proposed note edit
          </Text>
          <View
            testID="proposal-unsaved-badge"
            style={{ borderRadius: theme.radius.pill, backgroundColor: warning.wash, paddingHorizontal: 10, paddingVertical: 2 }}
          >
            <Text style={[theme.text('label'), { color: warning.text }]}>not saved · your note is unchanged</Text>
          </View>
        </View>
        <Text style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>
          An edit replaces the whole chunk.
        </Text>
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: theme.color.border.hairline, paddingHorizontal: theme.space.section, paddingVertical: theme.space.xxl, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: theme.space.xl }}>
        <Text numberOfLines={1} style={[theme.text('cardTitle'), { color: theme.color.text.primary, flexShrink: 1 }]}>{title}</Text>
        <Text style={[theme.text('caption'), { color: theme.color.text.tertiary }]}>
          {`read at revision ${proposal.chunkRevision} · ${changes} ${changes === 1 ? 'change' : 'changes'}`}
        </Text>
      </View>
      <View style={{ flexDirection: split ? 'row' : 'column', borderTopWidth: 1, borderTopColor: theme.color.border.hairline }}>
        <View
          style={[
            pane,
            split
              ? { borderRightWidth: 1, borderRightColor: theme.color.border.hairline }
              : { borderBottomWidth: 1, borderBottomColor: theme.color.border.hairline },
          ]}
        >
          <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>BEFORE</Text>
          <View testID="proposal-before"><DiffBody parts={diff.before} tone="removed" /></View>
        </View>
        <View style={pane}>
          <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>AFTER</Text>
          <View testID="proposal-after"><DiffBody parts={diff.after} tone="added" /></View>
        </View>
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: theme.color.border.hairline, padding: theme.space.section, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space.md }}>
        <ActionButton primary label="Confirm and save" onPress={onConfirm} disabled={confirmDisabled} testID="confirm-button" />
        <ActionButton label="Discard" accessibilityLabel="Discard the edit" onPress={onDiscard} disabled={busy} testID="discard-button" />
        <Text style={[theme.text('caption'), { color: theme.color.text.tertiary, marginLeft: split ? 'auto' : 0 }]}>
          Subjects, highlights and source link stay as they are
        </Text>
      </View>
    </View>
  );
}

/** Shown when confirming failed because the chunk moved past the revision the edit read. */
export function StaleEditNotice({ onAskAgain, disabled }: { onAskAgain: () => void; disabled: boolean }) {
  const theme = useStoneTheme();
  const danger = theme.color.status.danger;
  return (
    <View
      accessibilityRole="alert"
      testID="harness-error"
      style={{
        marginTop: theme.space.xl,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        gap: theme.space.xxl,
        padding: theme.space.card,
        backgroundColor: theme.color.bg.surface,
        borderRadius: theme.radius.card,
        borderWidth: 1,
        borderColor: danger.fill,
      }}
    >
      <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: danger.fill, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={theme.color.text.onFill} strokeWidth={3} strokeLinecap="round">
          <Path d="M18 6 6 18" />
          <Path d="m6 6 12 12" />
        </Svg>
      </View>
      <View style={{ flex: 1, minWidth: 200, gap: theme.space.xs }}>
        <Text style={[theme.text('cardTitle'), { color: theme.color.text.primary }]}>The note changed first</Text>
        <Text style={[theme.text('bodySmall'), { color: theme.color.text.secondary }]}>
          This chunk is newer than the revision the edit read. The edit was not applied, so your newer text is safe.
        </Text>
      </View>
      <ActionButton label="Ask again on the new text" onPress={onAskAgain} disabled={disabled} testID="stale-ask-again" />
    </View>
  );
}
