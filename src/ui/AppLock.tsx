import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { t } from '../i18n';
import { useSettings } from '../settings';
import { Palette, useStyles } from '../appTheme';

const GRACE_MS = 45_000;

/** Covers the whole app with a lock screen until the user authenticates (fingerprint or screen lock). */
export function AppLock({ children }: { children: React.ReactNode }) {
  const styles = useStyles(makeStyles);
  const { settings, loaded } = useSettings();
  const [locked, setLocked] = useState(true);
  const backgroundAt = useRef(0);
  const busy = useRef(false);

  const authenticate = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: t('authReason'),
        cancelLabel: t('cancel'),
        disableDeviceFallback: false,
      });
      if (res.success) setLocked(false);
    } catch {
      // stay locked
    } finally {
      busy.current = false;
    }
  }, []);

  // settings loaded: unlock immediately when the lock is off, otherwise ask
  useEffect(() => {
    if (!loaded) return;
    if (!settings.appLock) setLocked(false);
    else if (locked) authenticate();
  }, [loaded, settings.appLock, locked, authenticate]);

  // lock again when coming back after a while
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') {
        backgroundAt.current = Date.now();
      } else if (settings.appLock && backgroundAt.current && Date.now() - backgroundAt.current > GRACE_MS) {
        setLocked(true);
      }
    });
    return () => sub.remove();
  }, [settings.appLock]);

  const showLock = !loaded || (settings.appLock && locked);

  return (
    <View style={{ flex: 1 }}>
      {children}
      {showLock ? (
        <View style={styles.cover}>
          {loaded ? (
            <>
              <Text style={styles.icon}>🔒</Text>
              <Text style={styles.title}>{t('lockedTitle')}</Text>
              <Pressable onPress={authenticate} style={styles.btn}>
                <Text style={styles.btnText}>{t('unlock')}</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (th: Palette) =>
  StyleSheet.create({
    cover: { ...StyleSheet.absoluteFillObject, backgroundColor: th.bg, alignItems: 'center', justifyContent: 'center', gap: 14 },
    icon: { fontSize: 56 },
    title: { fontSize: 20, fontWeight: '800', color: th.text },
    btn: { backgroundColor: th.primary, borderRadius: 14, paddingHorizontal: 28, paddingVertical: 12, marginTop: 6 },
    btnText: { color: th.primaryText, fontWeight: '800', fontSize: 16 },
  });
