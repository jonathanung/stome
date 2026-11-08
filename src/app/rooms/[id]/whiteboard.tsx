import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { WhiteboardScreen } from '../../../whiteboard/WhiteboardScreen';

export default function WhiteboardRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <WhiteboardScreen roomId={id} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </>
  );
}
