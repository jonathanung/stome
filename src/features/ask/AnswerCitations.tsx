import { Pressable, Text, View } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import {
  citationsForProposal,
  type ChunkFocus,
  type CitationProposal,
  type SourceChunk,
} from './citations';
import { harnessColors } from './harnessColors';

type AnswerCitationsProps = {
  selectedChunkIds: readonly string[];
  chunks: readonly SourceChunk[];
  proposal: CitationProposal;
  onOpen: (focus: ChunkFocus) => void;
};

export function AnswerCitations({ selectedChunkIds, chunks, proposal, onOpen }: AnswerCitationsProps) {
  const theme = useStoneTheme();
  const colors = harnessColors(theme.color);
  const { citations, problems } = citationsForProposal(selectedChunkIds, chunks, proposal);
  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <Text style={[theme.text('label'), { color: colors.sourceLabel }]}>Sources</Text>
      {citations.map((citation) => {
        const label = citation.anchored
          ? `Show cited passage in ${citation.label}`
          : `Show source chunk ${citation.label}`;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            key={citation.chunkId}
            onPress={() => onOpen({
              chunkId: citation.chunkId,
              start: citation.anchorStart,
              end: citation.anchorEnd,
            })}
            style={{
              minHeight: theme.layout.control,
              justifyContent: 'center',
              borderColor: theme.color.border.strong,
              borderRadius: theme.radius.control,
              borderWidth: 1,
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
            testID={`citation-${citation.chunkId}`}
          >
            <Text style={[theme.text('bodySmall'), { color: colors.citationLabel }]}>{citation.label}</Text>
            {citation.anchored ? (
              <Text style={[theme.text('bodySmall'), { color: colors.citationQuote }]} testID={`citation-quote-${citation.chunkId}`}>
                {`Cited passage: ${citation.quote}`}
              </Text>
            ) : (
              <Text style={[theme.text('bodySmall'), { color: colors.citationQuote }]}>Included in this question</Text>
            )}
          </Pressable>
        );
      })}
      {problems.map((problem) => (
        <Text
          accessibilityRole="alert"
          key={`${problem.code}-${problem.chunkId}`}
          style={[theme.text('bodySmall'), { color: theme.color.status.danger.text }]}
          testID={`citation-error-${problem.chunkId}`}
        >
          {problem.message}
        </Text>
      ))}
    </View>
  );
}
