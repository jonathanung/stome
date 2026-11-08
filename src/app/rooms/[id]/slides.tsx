import { Stack } from 'expo-router';
import { useWindowDimensions } from 'react-native';

import { IpadSlidesPencil } from '../../../features/slides/IpadSlidesPencil';
import { PhoneSlideViewer } from '../../../features/slides/PhoneSlideViewer';
import { SlideWorkspace } from '../../../features/slides/SlideWorkspace';

export default function SlidesRoute() {
  const { width } = useWindowDimensions();
  const ipad = width >= 900 && width <= 1300;
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {width < 600 ? <PhoneSlideViewer /> : ipad ? <IpadSlidesPencil /> : <SlideWorkspace />}
    </>
  );
}
