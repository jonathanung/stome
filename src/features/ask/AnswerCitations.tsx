import { Pressable, Text, View } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';
import {
  citationsForProposal,
  type ChunkFocus,
  type CitationProposal,
  type SourceChunk,
} from './citations';

type AnswerCitationsProps = {
  selectedChunkIds: readonly string[];
  chunks: readonly SourceChunk[];
  proposal: CitationProposal;
  onOpen: (focus: ChunkFocus) => void;
};

export function AnswerCitations({ selectedChunkIds, chunks, proposal, onOpen }: AnswerCitationsProps) {
  const theme = useStoneTheme();
  const { citations, problems } = citationsForProposal(selectedChunkIds, chunks, proposal);
  return (
    <View style={{ gap: 6 }}>
      <Text style={[theme.text('eyebrow'), { color: theme.color.text.tertiary }]}>SOURCES</Text>
      {citations.map((citation, index) => {
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
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 10,
              backgroundColor: theme.color.bg.surface,
              borderRadius: theme.radius.control,
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
            testID={`citation-${citation.chunkId}`}
          >
            <View
              style={{
                minWidth: 18,
                height: 18,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 5,
                backgroundColor: theme.color.status.success.fill,
              }}
            >
              <Text style={{ color: theme.color.text.onFill, fontSize: 11, fontWeight: '700', lineHeight: 14 }}>{index + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[theme.text('label'), { color: theme.color.text.primary, fontWeight: '400', lineHeight: 18 }]}>
                <Text style={{ fontWeight: '600' }}>{`chunk ${index + 1}`}</Text>
                {` · ${citation.label}`}
              </Text>
              {citation.anchored ? (
                <Text style={[theme.text('label'), { color: theme.color.text.secondary, fontWeight: '400', lineHeight: 18 }]} testID={`citation-quote-${citation.chunkId}`}>
                  {`Cited passage: ${citation.quote}`}
                </Text>
              ) : (
                <Text style={[theme.text('label'), { color: theme.color.text.secondary, fontWeight: '400', lineHeight: 18 }]}>Included in this question</Text>
              )}
            </View>
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
