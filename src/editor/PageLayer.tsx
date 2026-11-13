import React, { memo, useEffect, useMemo, useState } from 'react';
import { Group, Image, Picture, Rect, Skia, useImage } from '@shopify/react-native-skia';
import type { Page } from '../types';
import { createBgPicture, createItemsPicture } from '../ink/render';
import { ensurePageImage } from '../services/storage';

type Props = { docId: string; page: Page; x: number; y: number };

/** One page inside the big Skia canvas: paper/PDF image + recorded ink picture. */
export const PageLayer = memo(function PageLayer({ docId, page, x, y }: Props) {
  const { w, h } = page;
  const items = useMemo(() => createItemsPicture(page.items, w, h), [page.items, w, h]);
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
      <Rect x={0} y={0} width={w} height={h} color="#FFFFFF" />
      {bg ? <Picture picture={bg} /> : null}
      {image ? (
        <Image
          image={image}
          x={0}
          y={0}
          width={w}
          height={h}
          fit="fill"
        />
      ) : null}
      <Picture picture={items} />
    </Group>
  );
});
