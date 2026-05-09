import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

export async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function saveJson<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function loadSecret(key: string): Promise<string> {
  if (Platform.OS === 'web') {
    return (await AsyncStorage.getItem(key)) ?? '';
  }

  if (await SecureStore.isAvailableAsync()) {
    return (await SecureStore.getItemAsync(key)) ?? '';
  }

  return (await AsyncStorage.getItem(key)) ?? '';
}

export async function saveSecret(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (value) {
      await AsyncStorage.setItem(key, value);
    } else {
      await AsyncStorage.removeItem(key);
    }
    return;
  }

  if (await SecureStore.isAvailableAsync()) {
    if (value) {
      await SecureStore.setItemAsync(key, value);
    } else {
      await SecureStore.deleteItemAsync(key);
    }
    return;
  }

  if (value) {
    await AsyncStorage.setItem(key, value);
  } else {
    await AsyncStorage.removeItem(key);
  }
}

