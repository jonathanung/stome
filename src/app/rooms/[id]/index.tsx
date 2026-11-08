import { Stack, useLocalSearchParams } from 'expo-router';

import { RoomScreen } from '../../../screens/RoomScreen';

export default function RoomRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const routeId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : 'room';
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <RoomScreen key={routeId} />
    </>
  );
}
