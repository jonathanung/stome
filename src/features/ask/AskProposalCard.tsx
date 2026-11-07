import { Pressable, Text, View } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import { AnswerCitations } from './AnswerCitations';
import {
  citationsForProposal,
  type ChunkFocus,
  type CitationProposal,
  type SourceChunk,
} from './citations';

type AskProposalCardProps = {
  body: string;
  proposal: CitationProposal;
  chunks: readonly SourceChunk[];
  selectedChunkIds: readonly string[];
  confirmDisabled: boolean;
  busy: boolean;
  onOpen: (focus: ChunkFocus) => void;
  onConfirm: () => void;
  onDecline: () => void;
};

/** "Proposed AI answer" card from the ask panel design: not saved until confirmed. */
export function AskProposalCard({
  body,
  proposal,
  chunks,
  selectedChunkIds,
  confirmDisabled,
  busy,
  onOpen,
  onConfirm,
  onDecline,
}: AskProposalCardProps) {
  const theme = useStoneTheme();
  const { citations } = citationsForProposal(selectedChunkIds, chunks, proposal);
  const pin = citations.find((citation) => citation.anchored);
  const pinChunkIndex = pin ? chunks.findIndex((chunk) => chunk.id === pin.chunkId) + 1 : 0;
  const warning = theme.color.status.warning;
  return (
    <View
      accessibilityLabel="proposed ai answer"
      style={{
        gap: 12,
        padding: 16,
        borderWidth: 1.5,
        borderColor: theme.color.border.strong,
        borderRadius: theme.radius.float,
        backgroundColor: theme.color.bg.canvas,
      }}
      testID="proposal-card"
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>PROPOSED AI ANSWER</Text>
        <View style={{ paddingHorizontal: 10, paddingVertical: 2, borderRadius: theme.radius.pill, backgroundColor: warning.wash }}>
          <Text style={[theme.text('label'), { color: warning.text }]}>not saved</Text>
        </View>
      </View>
      <Text style={[theme.text('bodySmall'), { color: theme.color.text.primary }]} testID="proposal-body">
        {body}
      </Text>
      <AnswerCitations chunks={chunks} onOpen={onOpen} proposal={proposal} selectedChunkIds={selectedChunkIds} />
      {pin ? (
        <View style={{ gap: 4, padding: 12, borderRadius: theme.radius.control, backgroundColor: theme.color.bg.surface }} testID="pins-on">
          <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>PINS ON</Text>
          <Text style={[theme.text('label'), { color: theme.color.text.primary, fontWeight: '400' }]}>
            {`chunk ${pinChunkIndex}, "${pin.quote}" · based on revision ${proposal.chunkRevision}`}
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: confirmDisabled }}
          disabled={confirmDisabled}
          onPress={onConfirm}
          style={{
            flex: 1,
            minHeight: theme.layout.control,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radius.lg,
            backgroundColor: theme.color.accent.bg,
            opacity: confirmDisabled ? 0.45 : 1,
          }}
          testID="confirm-button"
        >
          <Text style={[theme.text('buttonCompact'), { color: theme.color.accent.fg }]}>Confirm and pin</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Decline without writing"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={onDecline}
          style={{
            minHeight: theme.layout.control,
            paddingHorizontal: 16,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: theme.radius.lg,
            borderWidth: 1,
            borderColor: theme.color.border.strong,
            opacity: busy ? 0.45 : 1,
          }}
          testID="discard-button"
        >
          <Text style={[theme.text('buttonCompact'), { color: theme.color.text.primary }]}>Decline</Text>
        </Pressable>
      </View>
      <Text style={[theme.text('chip'), { color: theme.color.text.tertiary, fontWeight: '400' }]}>
        Decline writes nothing. A pinned answer joins your review queue. If the chunk changes first, the pin is refused and you can ask again.
      </Text>
    </View>
  );
}
