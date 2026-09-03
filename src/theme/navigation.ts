import { useMemo } from 'react';
import { DarkTheme, DefaultTheme, type Theme } from '@react-navigation/native';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { useThemeColor } from 'heroui-native';
import { useUniwind } from 'uniwind';

export type AppNavigationTheme = {
  isDark: boolean;
  statusBarStyle: 'light' | 'dark';
  navigationTheme: Theme;
  screenOptions: NativeStackNavigationOptions;
  colors: {
    background: string;
    foreground: string;
    muted: string;
    accent: string;
    separator: string;
    surface: string;
  };
};

/**
 * Derives React Navigation's theme and default stack options from the HeroUI
 * design tokens so the header, status bar and screen background follow the
 * same light/dark palette as every other component.
 */
export function useAppNavigationTheme(): AppNavigationTheme {
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  const [background, foreground, muted, accent, separator, surface] = useThemeColor([
    'background',
    'foreground',
    'muted',
    'accent',
    'separator',
    'surface',
  ]);

  return useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    const navigationTheme: Theme = {
      ...base,
      colors: {
        ...base.colors,
        primary: accent,
        background,
        card: background,
        text: foreground,
        border: separator,
        notification: accent,
      },
    };
    const screenOptions: NativeStackNavigationOptions = {
      headerStyle: { backgroundColor: background },
      headerShadowVisible: false,
      headerTintColor: foreground,
      headerTitleStyle: { color: foreground, fontSize: 17, fontWeight: '600' },
      headerBackButtonDisplayMode: 'minimal',
      contentStyle: { backgroundColor: background },
      freezeOnBlur: true,
    };
    return {
      isDark,
      statusBarStyle: isDark ? 'light' : 'dark',
      navigationTheme,
      screenOptions,
      colors: { background, foreground, muted, accent, separator, surface },
    };
  }, [accent, background, foreground, isDark, muted, separator, surface]);
}
