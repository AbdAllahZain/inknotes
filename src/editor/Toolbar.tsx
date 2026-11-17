import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { Palette, useStyles } from '../theme';
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
  select: '◌',
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
  rulerOn: boolean;
  onRuler: () => void;
  onImage: () => void;
};

export function Toolbar({ tool, onTool, color, onColor, size, onSize, shape, onShape, rulerOn, onRuler, onImage }: Props) {
  const styles = useStyles(makeStyles);
  const showColors = tool !== 'eraser' && tool !== 'hand' && tool !== 'select';
  const palette = tool === 'highlighter' ? HIGHLIGHT_COLORS : COLORS;
  const sizes = SIZES[tool];
  const showOptions = tool !== 'hand' && tool !== 'select';
  return (
    <View style={styles.wrap}>
      {showOptions ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optRow}>
          {tool === 'shape'
            ? SHAPES.map((s) => (
                <Pressable key={s.kind} onPress={() => onShape(s.kind)} style={[styles.chip, shape === s.kind && styles.chipOn]}>
                  <Text style={[styles.chipText, shape === s.kind && styles.chipTextOn]}>
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
                      c.toUpperCase() === '#FFFFFF' && styles.swatchWhite,
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
                  <Text style={{ fontSize: 10 + s * 0.38, color: styles.sizeText.color, fontWeight: '600' }}>A</Text>
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
                    backgroundColor: tool === 'eraser' ? styles.dim.color : color,
                    borderWidth: color.toUpperCase() === '#FFFFFF' ? 1 : 0,
                    borderColor: styles.dim.color,
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
            <Text style={[styles.toolIcon, tool === id && styles.onPrimary]}>{ICONS[id]}</Text>
            <Text style={[styles.toolLabel, tool === id && styles.onPrimary]}>{t(id)}</Text>
          </Pressable>
        ))}
        <View style={styles.sep} />
        <Pressable onPress={onImage} style={styles.tool}>
          <Text style={styles.toolIcon}>🖼</Text>
          <Text style={styles.toolLabel}>{t('image')}</Text>
        </Pressable>
        <Pressable onPress={onRuler} style={[styles.tool, rulerOn && styles.toolOn]}>
          <Text style={[styles.toolIcon, rulerOn && styles.onPrimary]}>📏</Text>
          <Text style={[styles.toolLabel, rulerOn && styles.onPrimary]}>{t('ruler')}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const makeStyles = (th: Palette) =>
  StyleSheet.create({
    wrap: { backgroundColor: th.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: th.border },
    optRow: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 10 },
    toolRow: { paddingHorizontal: 8, paddingBottom: 6, paddingTop: 2, gap: 4, flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
    tool: { alignItems: 'center', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 14, minWidth: 58 },
    toolOn: { backgroundColor: th.primary },
    toolIcon: { fontSize: 20, color: th.text },
    toolLabel: { fontSize: 11, color: th.textDim, marginTop: 1 },
    onPrimary: { color: th.primaryText },
    swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: 'transparent' },
    swatchWhite: { borderColor: th.border },
    swatchOn: { borderWidth: 3, borderColor: th.primary },
    sep: { width: 1, height: 24, backgroundColor: th.border, marginHorizontal: 2 },
    sizeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    sizeBtnOn: { backgroundColor: th.surfaceAlt, borderWidth: 2, borderColor: th.primary },
    sizeText: { color: th.text },
    dim: { color: th.textDim },
    chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: th.surfaceAlt },
    chipOn: { backgroundColor: th.primary },
    chipText: { fontSize: 13, color: th.text, fontWeight: '600' },
    chipTextOn: { color: th.primaryText },
  });
