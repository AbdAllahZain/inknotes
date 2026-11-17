import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { t } from '../i18n';
import { Palette, useStyles, useTheme } from '../theme';

type Props = {
  visible: boolean;
  title: string;
  initial?: string;
  placeholder?: string;
  multiline?: boolean;
  numeric?: boolean;
  okLabel?: string;
  extraLabel?: string;
  extraDanger?: boolean;
  onOk: (value: string) => void;
  onExtra?: () => void;
  onCancel: () => void;
};

export function PromptModal(p: Props) {
  const th = useTheme();
  const styles = useStyles(makeStyles);
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
            keyboardType={p.numeric ? 'number-pad' : 'default'}
            placeholder={p.placeholder}
            placeholderTextColor={th.textDim}
            style={[styles.input, p.multiline && { minHeight: 110, textAlignVertical: 'top' }]}
          />
          <View style={styles.row}>
            {p.extraLabel ? (
              <Pressable onPress={p.onExtra} style={styles.btn}>
                <Text style={[styles.btnText, p.extraDanger && { color: th.danger }]}>{p.extraLabel}</Text>
              </Pressable>
            ) : null}
            <View style={{ flex: 1 }} />
            <Pressable onPress={p.onCancel} style={styles.btn}>
              <Text style={styles.btnText}>{t('cancel')}</Text>
            </Pressable>
            <Pressable onPress={() => p.onOk(value)} style={[styles.btn, styles.btnPrimary]}>
              <Text style={[styles.btnText, { color: th.primaryText }]}>{p.okLabel ?? t('ok')}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (th: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: th.overlay, justifyContent: 'center', padding: 24 },
    card: { backgroundColor: th.surface, borderRadius: 18, padding: 18, maxWidth: 520, width: '100%', alignSelf: 'center' },
    title: { fontSize: 17, fontWeight: '700', color: th.text, marginBottom: 12 },
    input: {
      borderWidth: 1,
      borderColor: th.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      color: th.text,
      backgroundColor: th.bg,
    },
    row: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 8 },
    btn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
    btnPrimary: { backgroundColor: th.primary },
    btnText: { fontSize: 15, fontWeight: '600', color: th.text },
  });
