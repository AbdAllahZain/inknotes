import React, { memo, useEffect, useMemo, useState } from 'react';
import { Group, Image, Picture, Rect, Skia, useImage } from '@shopify/react-native-skia';
import type { Page } from '../types';
import { createBgPicture, createItemsPicture, imageFilesOf, loadImage } from '../ink/render';
import { ensurePageImage } from '../services/storage';
import { paperColor } from '../templates';

type Props = { docId: string; page: Page; x: number; y: number; hiddenIds?: string[] };

/** One page inside the big Skia canvas: paper/PDF image + recorded ink picture. */
export const PageLayer = memo(function PageLayer({ docId, page, x, y, hiddenIds }: Props) {
  const { w, h } = page;
  const [imgVersion, setImgVersion] = useState(0);
  const hiddenKey = hiddenIds && hiddenIds.length ? hiddenIds.join('|') : '';

  // make sure embedded pictures are decoded, then redraw
  useEffect(() => {
    const files = imageFilesOf(page.items);
    if (!files.length) return;
    let alive = true;
    Promise.all(files.map((f) => loadImage(docId, f))).then(() => alive && setImgVersion((v) => v + 1));
    return () => {
      alive = false;
    };
  }, [docId, page.items]);

  const items = useMemo(() => {
    const visible = hiddenKey ? page.items.filter((it) => !hiddenKey.split('|').includes(it.id)) : page.items;
    return createItemsPicture(visible, w, h, docId);
  }, [page.items, hiddenKey, w, h, docId, imgVersion]);
  const bg = useMemo(() => createBgPicture(page.bg, w, h), [page.bg, w, h]);
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    if (page.bg !== 'pdf') return;
    let alive = true;
    ensurePageImage(docId, page.pdfIndex ?? 0)
      .then((u) => alive && setUri(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [docId, page.bg, page.pdfIndex]);

  const image = useImage(uri);
  const clip = useMemo(() => Skia.XYWHRect(0, 0, w, h), [w, h]);

  return (
    <Group transform={[{ translateX: x }, { translateY: y }]} clip={clip}>
      <Rect x={0} y={0} width={w} height={h} color={paperColor(page.bg)} />
      {bg ? <Picture picture={bg} /> : null}
      {image ? <Image image={image} x={0} y={0} width={w} height={h} fit="fill" /> : null}
      <Picture picture={items} />
    </Group>
  );
});
