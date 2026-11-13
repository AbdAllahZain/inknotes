import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { theme } from '../theme';
import { COLORS, HIGHLIGHT_COLORS, SIZES, TOOL_ORDER } from '../tools';
import type { ShapeKind, ToolId } from '../types';

const ICONS: Record<ToolId, string> = {
  pen: '✎',
  fountain: '✒',
  pencil: '✐',
  highlighter: '🖍',
  eraser: '⌫',
  shape: '△',
  text: 'T',
  hand: '✋',
};

const SHAPES: { kind: ShapeKind; icon: string; label: 'line' | 'arrow' | 'rect' | 'ellipse' }[] = [
  { kind: 'line', icon: '╱', label: 'line' },
  { kind: 'arrow', icon: '➜', label: 'arrow' },
  { kind: 'rect', icon: '▭', label: 'rect' },
  { kind: 'ellipse', icon: '◯', label: 'ellipse' },
];

type Props = {
  tool: ToolId;
  onTool: (t: ToolId) => void;
  color: string;
  onColor: (c: string) => void;
  size: number;
  onSize: (s: number) => void;
  shape: ShapeKind;
  onShape: (s: ShapeKind) => void;
};

export function Toolbar({ tool, onTool, color, onColor, size, onSize, shape, onShape }: Props) {
  const showColors = tool !== 'eraser' && tool !== 'hand';
  const palette = tool === 'highlighter' ? HIGHLIGHT_COLORS : COLORS;
  const sizes = SIZES[tool];
  return (
    <View style={styles.wrap}>
      {tool !== 'hand' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optRow}>
          {tool === 'shape'
            ? SHAPES.map((s) => (
                <Pressable
                  key={s.kind}
                  onPress={() => onShape(s.kind)}
                  style={[styles.chip, shape === s.kind && styles.chipOn]}
                >
                  <Text style={[styles.chipText, shape === s.kind && { color: theme.primaryText }]}>
                    {s.icon} {t(s.label)}
                  </Text>
                </Pressable>
              ))
            : null}
          {showColors
            ? palette.map((c) => (
                <Pressable key={c} onPress={() => onColor(c)} hitSlop={4}>
                  <View
                    style={[
                      styles.swatch,
                      { backgroundColor: c },
                      c.toUpperCase() === '#FFFFFF' && { borderColor: theme.border },
                      color.toUpperCase() === c.toUpperCase() && styles.swatchOn,
                    ]}
                  />
                </Pressable>
              ))
            : null}
          {sizes.length ? <View style={styles.sep} /> : null}
          {sizes.map((s) => {
            const on = Math.abs(size - s) < 0.01;
            if (tool === 'text') {
              return (
                <Pressable key={s} onPress={() => onSize(s)} style={[styles.sizeBtn, on && styles.sizeBtnOn]}>
                  <Text style={{ fontSize: 10 + s * 0.38, color: theme.text, fontWeight: '600' }}>A</Text>
                </Pressable>
              );
            }
            const d = Math.max(5, Math.min(24, tool === 'highlighter' ? s * 0.8 : tool === 'eraser' ? s * 0.7 : s * 2 + 3));
            return (
              <Pressable key={s} onPress={() => onSize(s)} style={[styles.sizeBtn, on && styles.sizeBtnOn]}>
                <View
                  style={{
                    width: d,
                    height: d,
                    borderRadius: d / 2,
                    backgroundColor: tool === 'eraser' ? theme.textDim : color,
                    borderWidth: color.toUpperCase() === '#FFFFFF' ? 1 : 0,
                    borderColor: theme.border,
                    opacity: tool === 'highlighter' ? 0.6 : 1,
                  }}
                />
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolRow}>
        {TOOL_ORDER.map((id) => (
          <Pressable key={id} onPress={() => onTool(id)} style={[styles.tool, tool === id && styles.toolOn]}>
            <Text style={[styles.toolIcon, tool === id && { color: theme.primaryText }]}>{ICONS[id]}</Text>
            <Text style={[styles.toolLabel, tool === id && { color: theme.primaryText }]}>{t(id)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: theme.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
  optRow: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 10 },
  toolRow: { paddingHorizontal: 8, paddingBottom: 6, paddingTop: 2, gap: 4, flexGrow: 1, justifyContent: 'center' },
  tool: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, minWidth: 62 },
  toolOn: { backgroundColor: theme.primary },
  toolIcon: { fontSize: 20, color: theme.text },
  toolLabel: { fontSize: 11, color: theme.textDim, marginTop: 1 },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: 'transparent' },
  swatchOn: { borderWidth: 3, borderColor: theme.primary },
  sep: { width: 1, height: 24, backgroundColor: theme.border, marginHorizontal: 2 },
  sizeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sizeBtnOn: { backgroundColor: theme.surfaceAlt, borderWidth: 2, borderColor: theme.primary },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: theme.surfaceAlt },
  chipOn: { backgroundColor: theme.primary },
  chipText: { fontSize: 13, color: theme.text, fontWeight: '600' },
});
