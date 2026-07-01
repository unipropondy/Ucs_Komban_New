import { View, StyleSheet, Platform } from 'react-native';
import { CustomerDisplayContent } from '@unipro/customer-display';
import { Redirect } from 'expo-router';

/**
 * Bare-bones standalone Expo route for Electron's BrowserWindow.
 * Renders the CustomerDisplayContent fullscreen with no headers or nav.
 */
export default function CustomerDisplayStandalone() {
  if (Platform.OS !== 'web') {
    return <Redirect href="/(tabs)/category" />;
  }
  return (
    <View style={styles.root}>
      <CustomerDisplayContent />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F172A' },
});
