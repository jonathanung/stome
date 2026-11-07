import { Stack } from 'expo-router';

import { WhiteboardScreen } from '../../../features/whiteboard/WhiteboardScreen';

export default function WhiteboardRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <WhiteboardScreen />
    </>
  );
}
