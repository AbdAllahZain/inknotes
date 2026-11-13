import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

export type SheetItem = {
  key: string;
  label: string;
  icon?: string;
  danger?: boolean;
  checked?: boolean;
  hint?: string;
  onPress: () => void;
};

type Props = { visible: boolean; title?: string; items: SheetItem[]; onClose: () => void };

export function SheetMenu({ visible, title, items, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          <ScrollView>
            {items.map((it) => (
              <Pressable
                key={it.key}
                onPress={() => {
                  onClose();
                  it.onPress();
                }}
                style={({ pressed }) => [styles.item, pressed && { backgroundColor: theme.surfaceAlt }]}
              >
                <Text style={styles.icon}>{it.icon ?? ''}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, it.danger && { color: theme.danger }]}>{it.label}</Text>
                  {it.hint ? <Text style={styles.hint}>{it.hint}</Text> : null}
                </View>
                {it.checked !== undefined ? <Text style={styles.check}>{it.checked ? '☑' : '☐'}</Text> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: theme.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 18,
    paddingTop: 8,
    maxHeight: '75%',
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  title: { fontSize: 15, fontWeight: '700', color: theme.textDim, paddingHorizontal: 20, paddingVertical: 10 },
  item: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 14 },
  icon: { fontSize: 20, width: 28, textAlign: 'center' },
  label: { fontSize: 16, color: theme.text, fontWeight: '500' },
  hint: { fontSize: 12.5, color: theme.textDim, marginTop: 2 },
  check: { fontSize: 20, color: theme.primary },
});
