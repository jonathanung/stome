import { Stack } from 'expo-router';

import { StudyLibraryScreen } from '../../screens/StudyLibraryScreen';

export default function StudyRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StudyLibraryScreen />
    </>
  );
}
