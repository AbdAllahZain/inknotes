import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { t } from '../i18n';
import { theme } from '../theme';

type Props = {
  visible: boolean;
  title: string;
  initial?: string;
  placeholder?: string;
  multiline?: boolean;
  okLabel?: string;
  extraLabel?: string;
  extraDanger?: boolean;
  onOk: (value: string) => void;
  onExtra?: () => void;
  onCancel: () => void;
};

export function PromptModal(p: Props) {
  const [value, setValue] = useState(p.initial ?? '');
  useEffect(() => {
    if (p.visible) setValue(p.initial ?? '');
  }, [p.visible, p.initial]);
  return (
    <Modal visible={p.visible} transparent animationType="fade" onRequestClose={p.onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={p.onCancel} />
        <View style={styles.card}>
          <Text style={styles.title}>{p.title}</Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            autoFocus
            multiline={p.multiline}
            placeholder={p.placeholder}
            placeholderTextColor={theme.textDim}
            style={[styles.input, p.multiline && { minHeight: 110, textAlignVertical: 'top' }]}
          />
          <View style={styles.row}>
            {p.extraLabel ? (
              <Pressable onPress={p.onExtra} style={styles.btn}>
                <Text style={[styles.btnText, p.extraDanger && { color: theme.danger }]}>{p.extraLabel}</Text>
              </Pressable>
            ) : null}
            <View style={{ flex: 1 }} />
            <Pressable onPress={p.onCancel} style={styles.btn}>
              <Text style={styles.btnText}>{t('cancel')}</Text>
            </Pressable>
            <Pressable onPress={() => p.onOk(value)} style={[styles.btn, styles.btnPrimary]}>
              <Text style={[styles.btnText, { color: theme.primaryText }]}>{p.okLabel ?? t('ok')}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: theme.surface, borderRadius: 18, padding: 18, maxWidth: 520, width: '100%', alignSelf: 'center' },
  title: { fontSize: 17, fontWeight: '700', color: theme.text, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: theme.text,
    backgroundColor: theme.bg,
  },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 8 },
  btn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  btnPrimary: { backgroundColor: theme.primary },
  btnText: { fontSize: 15, fontWeight: '600', color: theme.text },
});
