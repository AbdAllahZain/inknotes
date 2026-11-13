import type { PageBg } from './types';

export type TemplateGeometry = {
  lines: number[][]; // [x1,y1,x2,y2]
  dots: number[][]; // [x,y]
  color: string;
};

/** Geometry shared by the on-screen renderer and the PDF exporter. */
export function templateGeometry(bg: PageBg, w: number, h: number): TemplateGeometry {
  const lines: number[][] = [];
  const dots: number[][] = [];
  if (bg === 'lined') {
    const gap = 28;
    for (let y = 70; y < h - 20; y += gap) lines.push([24, y, w - 24, y]);
    lines.push([64, 40, 64, h - 24]);
  } else if (bg === 'grid') {
    const gap = 24;
    for (let y = gap; y < h; y += gap) lines.push([0, y, w, y]);
    for (let x = gap; x < w; x += gap) lines.push([x, 0, x, h]);
  } else if (bg === 'dots') {
    const gap = 24;
    for (let y = gap; y < h; y += gap) for (let x = gap; x < w; x += gap) dots.push([x, y]);
  }
  return { lines, dots, color: '#B9C6E4' };
}
