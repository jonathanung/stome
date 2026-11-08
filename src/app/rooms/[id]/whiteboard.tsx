import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { whiteboardNotesTarget } from '../../../features/room/whiteboard-entry';
import { WhiteboardScreen } from '../../../whiteboard/WhiteboardScreen';

export default function WhiteboardRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const roomId = Array.isArray(id) ? id[0] : id;
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <WhiteboardScreen key={roomId ?? 'board'} roomId={roomId} onBack={() => (router.canGoBack() ? router.back() : router.replace(whiteboardNotesTarget(roomId)))} />
    </>
  );
}
