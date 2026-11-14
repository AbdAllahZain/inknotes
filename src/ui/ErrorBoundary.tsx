import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { logError } from '../services/crashLog';
import { theme } from '../theme';

type Props = { onBack?: () => void; children: React.ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    logError(error, 'render');
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>{t('errorTitle')}</Text>
        <Text style={styles.hint}>{t('errorHint')}</Text>
        <ScrollView style={styles.box}>
          <Text selectable style={styles.mono}>
            {(error.message ?? String(error)) + '\n\n' + (error.stack ?? '').split('\n').slice(0, 10).join('\n')}
          </Text>
        </ScrollView>
        {this.props.onBack ? (
          <Pressable onPress={this.props.onBack} style={styles.btn}>
            <Text style={styles.btnText}>{t('back')}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg, padding: 20, paddingTop: 48 },
  title: { fontSize: 20, fontWeight: '800', color: theme.danger, marginBottom: 6 },
  hint: { fontSize: 14, color: theme.textDim, marginBottom: 12 },
  box: { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.border },
  mono: { fontFamily: 'monospace', fontSize: 12, color: theme.text },
  btn: { marginTop: 14, backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
