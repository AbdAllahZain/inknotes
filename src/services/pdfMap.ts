import type { PDFPage } from 'pdf-lib';
import type { Page } from '../types';

export type Mapper = {
  map: (dx: number, dy: number) => [number, number];
  sx: number;
  sy: number;
  rot: number;
};

export function makeMapper(pdfPage: PDFPage, p: Page, isNote: boolean): Mapper {
  if (isNote) {
    return { map: (dx, dy) => [dx, p.h - dy], sx: 1, sy: 1, rot: 0 };
  }
  const crop = pdfPage.getCropBox();
  const rot = ((pdfPage.getRotation().angle % 360) + 360) % 360;
  const W = crop.width;
  const H = crop.height;
  const dispW = rot % 180 === 0 ? W : H;
  const dispH = rot % 180 === 0 ? H : W;
  const sx = dispW / p.w;
  const sy = dispH / p.h;
  const map = (dx: number, dy: number): [number, number] => {
    const u = dx * sx;
    const v = dy * sy;
    switch (rot) {
      case 90:
        return [crop.x + v, crop.y + u];
      case 180:
        return [crop.x + W - u, crop.y + v];
      case 270:
        return [crop.x + W - v, crop.y + H - u];
      default:
        return [crop.x + u, crop.y + H - v];
    }
  };
  return { map, sx, sy, rot };
}

/** SVG path string whose y axis is negated, because pdf-lib flips y when drawing SVG paths. */
export function polyToSvg(poly: number[], m: Mapper): string {
  let d = '';
  for (let i = 0; i < poly.length; i += 2) {
    const [X, Y] = m.map(poly[i], poly[i + 1]);
    d += (i === 0 ? 'M ' : ' L ') + X.toFixed(2) + ' ' + (-Y).toFixed(2);
  }
  return d + ' Z';
}

