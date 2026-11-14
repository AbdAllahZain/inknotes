import * as FileSystem from 'expo-file-system';
import { Alert } from 'react-native';

const FILE = FileSystem.documentDirectory + 'last-error.txt';

function describe(error: unknown): string {
  const e = error as { message?: string; stack?: string } | undefined;
  const msg = e?.message ?? String(error);
  const stack = (e?.stack ?? '').split('\n').slice(0, 8).join('\n');
  return (msg + (stack ? '\n' + stack : '')).slice(0, 1400);
}

export async function logError(error: unknown, where = ''): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(FILE, new Date().toISOString() + (where ? ' [' + where + ']' : '') + '\n' + describe(error));
  } catch {}
}

export async function readLastError(): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(FILE);
    if (!info.exists) return null;
    return await FileSystem.readAsStringAsync(FILE);
  } catch {
    return null;
  }
}

export async function clearLastError(): Promise<void> {
  try {
    await FileSystem.deleteAsync(FILE, { idempotent: true });
  } catch {}
}

/**
 * Catches every JS error (including ones raised from Reanimated worklets and event handlers),
 * saves it, and shows it instead of letting the app close silently.
 */
export function installGlobalErrorHandler(): void {
  const EU = (globalThis as any).ErrorUtils;
  if (!EU?.setGlobalHandler) return;
  const previous = EU.getGlobalHandler?.();
  let lastShown = 0;
  EU.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    logError(error, isFatal ? 'fatal' : 'error');
    const now = Date.now();
    if (now - lastShown > 5000) {
      lastShown = now;
      try {
        Alert.alert('خطأ / Error', describe(error).slice(0, 700));
      } catch {}
    }
    if (!isFatal && previous) previous(error, isFatal);
  });
}
