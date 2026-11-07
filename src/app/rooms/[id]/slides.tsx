import { Stack } from 'expo-router';

import { PhoneSlideViewer } from '../../../features/slides/PhoneSlideViewer';

export default function SlidesRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <PhoneSlideViewer />
    </>
  );
}
