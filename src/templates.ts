import type { PageBg } from './types';

export type TemplateGeometry = {
  lines: number[][]; // [x1,y1,x2,y2]
  dots: number[][]; // [x,y]
  color: string;
};

export function paperColor(bg: PageBg): string {
  if (bg === 'dark') return '#262833';
  if (bg === 'yellow') return '#FFF4B8';
  return '#FFFFFF';
}

/** Geometry shared by the on-screen renderer and the PDF exporter. */
export function templateGeometry(bg: PageBg, w: number, h: number): TemplateGeometry {
  const lines: number[][] = [];
  const dots: number[][] = [];
  let color = '#B9C6E4';
  if (bg === 'lined' || bg === 'yellow') {
    const gap = 28;
    for (let y = 70; y < h - 20; y += gap) lines.push([24, y, w - 24, y]);
    lines.push([64, 40, 64, h - 24]);
    if (bg === 'yellow') color = '#D9BE5C';
  } else if (bg === 'grid') {
    const gap = 24;
    for (let y = gap; y < h; y += gap) lines.push([0, y, w, y]);
    for (let x = gap; x < w; x += gap) lines.push([x, 0, x, h]);
  } else if (bg === 'dots') {
    const gap = 24;
    for (let y = gap; y < h; y += gap) for (let x = gap; x < w; x += gap) dots.push([x, y]);
  } else if (bg === 'cornell') {
    lines.push([0, 70, w, 70]);
    lines.push([170, 70, 170, h - 170]);
    lines.push([0, h - 170, w, h - 170]);
    for (let y = 98; y < h - 170; y += 28) lines.push([170, y, w - 20, y]);
    color = '#9FB1D8';
  } else if (bg === 'music') {
    // staves of five lines
    for (let y0 = 70; y0 + 32 < h - 40; y0 += 62) {
      for (let i = 0; i < 5; i++) lines.push([30, y0 + i * 8, w - 30, y0 + i * 8]);
    }
    color = '#8A93AD';
  } else if (bg === 'dark') {
    const gap = 24;
    for (let y = gap; y < h; y += gap) for (let x = gap; x < w; x += gap) dots.push([x, y]);
    color = '#5E6378';
  }
  return { lines, dots, color };
}
