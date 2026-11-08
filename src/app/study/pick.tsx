import { Stack } from 'expo-router';

import { StudyLibraryPicker } from '../../screens/StudyLibraryPicker';

export default function StudyPickRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <StudyLibraryPicker />
    </>
  );
}
