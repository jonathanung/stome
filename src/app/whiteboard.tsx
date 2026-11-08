import { useRouter } from 'expo-router';

import { WhiteboardScreen } from '../whiteboard/WhiteboardScreen';

export default function WhiteboardRoute() {
  const router = useRouter();
  return <WhiteboardScreen onBack={() => router.back()} />;
}
