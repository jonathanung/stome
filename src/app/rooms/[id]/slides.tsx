import { Stack } from 'expo-router';
import { useWindowDimensions } from 'react-native';

import { PhoneSlideViewer } from '../../../features/slides/PhoneSlideViewer';
import { SlideWorkspace } from '../../../features/slides/SlideWorkspace';

export default function SlidesRoute() {
  const { width } = useWindowDimensions();
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {width < 600 ? <PhoneSlideViewer /> : <SlideWorkspace />}
    </>
  );
}
