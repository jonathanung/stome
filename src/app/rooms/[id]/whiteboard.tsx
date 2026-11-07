import { Stack } from 'expo-router';
import { useWindowDimensions } from 'react-native';

import { IpadWhiteboardScreen } from '../../../features/whiteboard/IpadWhiteboardScreen';
import { WhiteboardScreen } from '../../../features/whiteboard/WhiteboardScreen';

export default function WhiteboardRoute() {
  const { width } = useWindowDimensions();
  // iPad widths get the pencil-first layout; desktop keeps the tool rail.
  const tablet = width >= 900 && width < 1300;
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {tablet ? <IpadWhiteboardScreen /> : <WhiteboardScreen />}
    </>
  );
}
