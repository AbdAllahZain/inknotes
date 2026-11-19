import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './navigation';
import { EditorScreen } from './screens/EditorScreen';
import { HomeScreen } from './screens/HomeScreen';
import { SettingsProvider } from './settings';
import { ThemeProvider, useTheme } from './appTheme';
import { AppLock } from './ui/AppLock';

const Stack = createNativeStackNavigator<RootStackParamList>();

function Root() {
  const th = useTheme();
  const base = th.isDark ? DarkTheme : DefaultTheme;
  return (
    <NavigationContainer
      theme={{ ...base, colors: { ...base.colors, background: th.bg, card: th.surface, text: th.text, border: th.border, primary: th.primary } }}
    >
      <AppLock>
        <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Editor" component={EditorScreen} />
        </Stack.Navigator>
      </AppLock>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SettingsProvider>
          <ThemeProvider>
            <Root />
          </ThemeProvider>
        </SettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
