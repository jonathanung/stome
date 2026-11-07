import { Link } from 'expo-router';
import { View } from 'react-native';

import { NotesScreen } from '../screens/NotesScreen';

export default function HomeScreen() {
  return <View style={{ flex: 1 }}>
    <Link href="/import" style={{ padding: 16, fontSize: 17 }}>Import Markdown notes</Link>
    <NotesScreen />
  </View>;
}
