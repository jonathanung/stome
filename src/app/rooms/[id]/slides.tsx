import { Stack } from 'expo-router';

import { SlideWorkspace } from '../../../features/slides/SlideWorkspace';

export default function SlidesRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SlideWorkspace />
    </>
  );
}
