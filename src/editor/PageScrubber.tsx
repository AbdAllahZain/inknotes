import React, { useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, StyleSheet, Text, View } from 'react-native';
import { Palette, useStyles } from '../appTheme';

type Props = { total: number; current: number; onScrub: (index: number) => void };

const THUMB_H = 48;

/**
 * Fast page scroller on the screen edge: grab the handle and drag to jump through many pages.
 * Only the handle reacts to touch, so writing near the page edge is never blocked.
 */
export function PageScrubber({ total, current, onScrub }: Props) {
  const styles = useStyles(makeStyles);
  const [h, setH] = useState(1);
  const [drag, setDrag] = useState<number | null>(null);
  const hRef = useRef(1);
  const totalRef = useRef(total);
  const currentRef = useRef(current);
  const cbRef = useRef(onScrub);
  const startTop = useRef(0);
  const lastIdx = useRef(-1);
  totalRef.current = total;
  currentRef.current = current;
  cbRef.current = onScrub;

  const travel = () => Math.max(1, hRef.current - THUMB_H);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const n = Math.max(1, totalRef.current - 1);
          startTop.current = (currentRef.current / n) * travel();
          lastIdx.current = -1;
          setDrag(currentRef.current);
        },
        onPanResponderMove: (_e, g) => {
          const top = Math.max(0, Math.min(travel(), startTop.current + g.dy));
          const idx = Math.round((top / travel()) * Math.max(0, totalRef.current - 1));
          setDrag(idx);
          if (idx !== lastIdx.current) {
            lastIdx.current = idx;
            cbRef.current(idx);
          }
        },
        onPanResponderRelease: () => setDrag(null),
        onPanResponderTerminate: () => setDrag(null),
      }),
    []
  );

  const onLayout = (e: LayoutChangeEvent) => {
    hRef.current = e.nativeEvent.layout.height;
    setH(e.nativeEvent.layout.height);
  };

  if (total < 4) return null;
  const shown = drag ?? current;
  const top = total > 1 ? (shown / (total - 1)) * Math.max(0, h - THUMB_H) : 0;

  return (
    <View style={styles.zone} pointerEvents="box-none" onLayout={onLayout}>
      <View style={styles.track} pointerEvents="none" />
      <View style={[styles.hit, { top: Math.max(0, top - 6) }]} {...responder.panHandlers}>
        <View style={[styles.thumb, drag !== null && styles.thumbActive]} pointerEvents="none" />
      </View>
      {drag !== null ? (
        <View style={[styles.bubble, { top: Math.max(0, top + 4) }]} pointerEvents="none">
          <Text style={styles.bubbleText}>
            {drag + 1} / {total}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (th: Palette) =>
  StyleSheet.create({
    zone: { position: 'absolute', right: 0, top: 56, bottom: 64, width: 44 },
    track: { position: 'absolute', right: 15, top: 0, bottom: 0, width: 4, borderRadius: 2, backgroundColor: 'rgba(120,125,150,0.22)' },
    hit: { position: 'absolute', right: 0, width: 44, height: THUMB_H + 12, justifyContent: 'center', alignItems: 'flex-end' },
    thumb: { width: 22, height: THUMB_H, borderRadius: 11, marginRight: 6, backgroundColor: 'rgba(79,70,229,0.55)' },
    thumbActive: { backgroundColor: th.primary, width: 28, marginRight: 4 },
    bubble: {
      position: 'absolute',
      right: 50,
      backgroundColor: 'rgba(27,29,42,0.9)',
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 6,
    },
    bubbleText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  });
