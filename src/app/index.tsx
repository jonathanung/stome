import { Link } from 'expo-router';
import { View } from 'react-native';

import { useStoneTheme } from '../../design-theme/src/primitives';
import { RoomsScreen } from '../screens/RoomsScreen';

/** Home entry for Today. The rooms link row stays in RoomsScreen, which pull request #80 is editing. */
export default function Home() {
  const theme = useStoneTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg.canvas }}>
      <View style={{ width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 16 }}>
        <Link
          href="/today"
          style={{ color: theme.color.text.primary, fontSize: 16, textDecorationLine: 'underline' }}
          testID="open-today"
        >
          Today
        </Link>
      </View>
      <View style={{ flex: 1 }}>
        <RoomsScreen />
      </View>
    </View>
  );
}
