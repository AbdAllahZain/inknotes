import type { ShapeKind } from './ink/engine';

export type { ShapeKind };

export type ToolId =
  | 'pen'
  | 'fountain'
  | 'pencil'
  | 'highlighter'
  | 'eraser'
  | 'shape'
  | 'text'
  | 'select'
  | 'hand';
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
  /** set when the shape came from "hold to snap" so it keeps the pen look (e.g. translucent highlighter) */
  tool?: InkTool;
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

export type ImageItem = {
  id: string;
  k: 'i';
  x: number;
  y: number;
  w: number;
  h: number;
  /** file name inside the document folder */
  file: string;
};

export type Item = StrokeItem | ShapeItem | TextItem | ImageItem;

export type PageBg = 'blank' | 'lined' | 'grid' | 'dots' | 'cornell' | 'music' | 'yellow' | 'dark' | 'pdf';

export const PAPER_CHOICES: PageBg[] = ['blank', 'lined', 'grid', 'dots', 'cornell', 'music', 'yellow', 'dark'];

export type Page = {
  id: string;
  w: number;
  h: number;
  bg: PageBg;
  items: Item[];
  /** only for pages that come from the imported PDF: index inside the source PDF */
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
  folder?: string;
  tags?: string[];
};

export type Folder = { id: string; name: string };

export type ThemeMode = 'system' | 'light' | 'dark';

export type Settings = {
  /** finger scrolls / zooms, only the pen draws (palm rejection) */
  stylusOnly: boolean;
  themeMode: ThemeMode;
  appLock: boolean;
};

export const DEFAULT_SETTINGS: Settings = { stylusOnly: false, themeMode: 'system', appLock: false };

export const A4 = { w: 595, h: 842 };
