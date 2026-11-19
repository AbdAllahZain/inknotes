import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Palette, useStyles } from '../appTheme';

export type SheetItem = {
  key: string;
  label: string;
  icon?: string;
  danger?: boolean;
  checked?: boolean;
  hint?: string;
  /** a non-pressable section title */
  header?: boolean;
  /** keep the sheet open after pressing */
  keepOpen?: boolean;
  onPress?: () => void;
};

type Props = { visible: boolean; title?: string; items: SheetItem[]; onClose: () => void };

export function SheetMenu({ visible, title, items, onClose }: Props) {
  const styles = useStyles(makeStyles);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          <ScrollView>
            {items.map((it) =>
              it.header ? (
                <Text key={it.key} style={styles.header}>
                  {it.label}
                </Text>
              ) : (
                <Pressable
                  key={it.key}
                  onPress={() => {
                    if (!it.keepOpen) onClose();
                    it.onPress?.();
                  }}
                  style={({ pressed }) => [styles.item, pressed && styles.pressed]}
                >
                  <Text style={styles.icon}>{it.icon ?? ''}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.label, it.danger && styles.danger]}>{it.label}</Text>
                    {it.hint ? <Text style={styles.hint}>{it.hint}</Text> : null}
                  </View>
                  {it.checked !== undefined ? <Text style={styles.check}>{it.checked ? '☑' : '☐'}</Text> : null}
                </Pressable>
              )
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (th: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: th.overlay, justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: th.surface,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingBottom: 18,
      paddingTop: 8,
      maxHeight: '80%',
      width: '100%',
      maxWidth: 560,
      alignSelf: 'center',
    },
    title: { fontSize: 15, fontWeight: '700', color: th.textDim, paddingHorizontal: 20, paddingVertical: 10 },
    header: { fontSize: 12.5, fontWeight: '800', color: th.primary, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 },
    item: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 13, gap: 14 },
    pressed: { backgroundColor: th.surfaceAlt },
    icon: { fontSize: 20, width: 28, textAlign: 'center', color: th.text },
    label: { fontSize: 16, color: th.text, fontWeight: '500' },
    danger: { color: th.danger },
    hint: { fontSize: 12.5, color: th.textDim, marginTop: 2 },
    check: { fontSize: 20, color: th.primary },
  });
