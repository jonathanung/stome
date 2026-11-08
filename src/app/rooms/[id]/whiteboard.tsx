import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { WhiteboardScreen } from '../../../whiteboard/WhiteboardScreen';

export default function WhiteboardRoute() {
  const router = useRouter();
  // Keep the room id available for future persistence — the screen shows ← Notes to go back
  useLocalSearchParams<{ id?: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <WhiteboardScreen onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </>
  );
}
