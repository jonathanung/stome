import { Stack } from 'expo-router';

import { ReviewScreen } from '../../../features/review/ReviewScreen';

export default function ReviewRoute() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ReviewScreen />
    </>
  );
}
