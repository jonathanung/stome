import { Stack, useRouter } from 'expo-router';

import { WhiteboardScreen } from '../whiteboard/WhiteboardScreen';

export default function WhiteboardRoute() {
  const router = useRouter();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <WhiteboardScreen onBack={() => router.back()} />
    </>
  );
}
