import type { ShapeKind } from './ink/engine';

export type { ShapeKind };

export type ToolId = 'pen' | 'fountain' | 'pencil' | 'highlighter' | 'eraser' | 'shape' | 'text' | 'hand';
export type InkTool = 'pen' | 'fountain' | 'pencil' | 'highlighter';

export type StrokeItem = {
  id: string;
  k: 's';
  tool: InkTool;
  color: string;
  size: number;
  /** flat [x, y, pressure, ...] in page units */
  pts: number[];
};

export type ShapeItem = {
  id: string;
  k: 'h';
  shape: ShapeKind;
  color: string;
  size: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type TextItem = {
  id: string;
  k: 't';
  x: number;
  y: number;
  w: number;
  text: string;
  color: string;
  fontSize: number;
};

export type Item = StrokeItem | ShapeItem | TextItem;

export type PageBg = 'blank' | 'lined' | 'grid' | 'dots' | 'pdf';

export type Page = {
  id: string;
  w: number;
  h: number;
  bg: PageBg;
  items: Item[];
  /** only for PDF documents: index of the page inside the source PDF */
  pdfIndex?: number;
};

export type DocType = 'note' | 'pdf';

export type Doc = {
  id: string;
  title: string;
  type: DocType;
  createdAt: number;
  updatedAt: number;
  pages: Page[];
};

export type DocMeta = {
  id: string;
  title: string;
  type: DocType;
  updatedAt: number;
  pageCount: number;
  thumb?: string;
};

export type Settings = {
  /** finger scrolls / zooms, only the pen draws (palm rejection) */
  stylusOnly: boolean;
};

export const A4 = { w: 595, h: 842 };
