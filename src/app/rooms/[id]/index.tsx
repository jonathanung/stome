import { Stack } from 'expo-router';

import { RoomScreen } from '../../../screens/RoomScreen';

export default function RoomRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <RoomScreen />
    </>
  );
}
