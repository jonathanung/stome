import { Stack } from 'expo-router';

import { StudySessionScreen } from '../../../screens/StudySessionScreen';

export default function StudyRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StudySessionScreen />
    </>
  );
}
