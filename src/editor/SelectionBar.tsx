import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { Palette, useStyles } from '../theme';
import { COLORS } from '../tools';

type Props = {
  count: number;
  canColor: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onColor: (c: string) => void;
  onDone: () => void;
};

/** Contextual bar shown while items are selected. */
export function SelectionBar({ count, canColor, onDelete, onDuplicate, onColor, onDone }: Props) {
  const styles = useStyles(makeStyles);
  const [picking, setPicking] = useState(false);
  return (
    <View style={styles.wrap}>
      {picking ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.colors}>
          {COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => {
                onColor(c);
                setPicking(false);
              }}
            >
              <View style={[styles.swatch, { backgroundColor: c }]} />
            </Pressable>
          ))}
          <Pressable onPress={() => setPicking(false)} style={styles.btn}>
            <Text style={styles.btnText}>{t('cancel')}</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <View style={styles.row}>
          <Text style={styles.count}>{count}</Text>
          <Pressable onPress={onDuplicate} style={styles.btn}>
            <Text style={styles.btnText}>⧉ {t('duplicate')}</Text>
          </Pressable>
          {canColor ? (
            <Pressable onPress={() => setPicking(true)} style={styles.btn}>
              <Text style={styles.btnText}>🎨 {t('recolor')}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onDelete} style={styles.btn}>
            <Text style={[styles.btnText, styles.danger]}>🗑 {t('delete')}</Text>
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable onPress={onDone} style={[styles.btn, styles.done]}>
            <Text style={[styles.btnText, styles.doneText]}>{t('clearSelection')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const makeStyles = (th: Palette) =>
  StyleSheet.create({
    wrap: { backgroundColor: th.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: th.border },
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, gap: 8 },
    count: {
      minWidth: 26,
      height: 26,
      borderRadius: 13,
      textAlign: 'center',
      textAlignVertical: 'center',
      backgroundColor: th.primary,
      color: th.primaryText,
      fontWeight: '800',
      overflow: 'hidden',
    },
    btn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, backgroundColor: th.surfaceAlt },
    btnText: { fontSize: 13.5, fontWeight: '700', color: th.text },
    danger: { color: th.danger },
    done: { backgroundColor: th.primary },
    doneText: { color: th.primaryText },
    colors: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 10 },
    swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: th.border },
  });
