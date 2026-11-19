import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { t } from '../i18n';
import { logError } from '../services/crashLog';
import { ThemeContext } from '../appTheme';

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
      <ThemeContext.Consumer>
        {(th) => (
          <View style={{ flex: 1, backgroundColor: th.bg, padding: 20, paddingTop: 48 }}>
            <Text style={{ fontSize: 20, fontWeight: '800', color: th.danger, marginBottom: 6 }}>{t('errorTitle')}</Text>
            <Text style={{ fontSize: 14, color: th.textDim, marginBottom: 12 }}>{t('errorHint')}</Text>
            <ScrollView
              style={{ flex: 1, backgroundColor: th.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: th.border }}
            >
              <Text selectable style={{ fontFamily: 'monospace', fontSize: 12, color: th.text }}>
                {(error.message ?? String(error)) + '\n\n' + (error.stack ?? '').split('\n').slice(0, 10).join('\n')}
              </Text>
            </ScrollView>
            {this.props.onBack ? (
              <Pressable
                onPress={this.props.onBack}
                style={{ marginTop: 14, backgroundColor: th.primary, borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}
              >
                <Text style={{ color: th.primaryText, fontWeight: '700', fontSize: 16 }}>{t('back')}</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </ThemeContext.Consumer>
    );
  }
}
