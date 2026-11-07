import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';

import { WhiteboardScreen } from './src/whiteboard/WhiteboardScreen';

export default function App() {
  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      <WhiteboardScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
