import { Text, View } from 'react-native';

import { useStoneTheme } from '../../../design-theme/src/primitives';

type AskSessionHeaderProps = {
  title: string;
  roomName: string;
  chunkCount: number;
  completed: boolean;
};

/** "session · why oxygen" header: read-only scope summary and state chip. */
export function AskSessionHeader({ title, roomName, chunkCount, completed }: AskSessionHeaderProps) {
  const theme = useStoneTheme();
  const success = theme.color.status.success;
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
      testID="ask-session-header"
    >
      <View style={{ flex: 1 }}>
        <Text style={[theme.text('actionTitle'), { color: theme.color.text.primary }]}>{`session · ${title}`}</Text>
        <Text style={[theme.text('meta'), { color: theme.color.text.tertiary }]}>
          {`${roomName} · ${chunkCount} ${chunkCount === 1 ? 'chunk' : 'chunks'} · read only`}
        </Text>
      </View>
      {completed ? (
        <View style={{ paddingHorizontal: 10, paddingVertical: 2, borderRadius: theme.radius.pill, backgroundColor: success.wash }}>
          <Text style={[theme.text('label'), { color: success.text }]}>completed</Text>
        </View>
      ) : null}
    </View>
  );
}
