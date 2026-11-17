import type { InkTool, ToolId } from './types';

export type InkPreset = {
  /** 0 = constant width .. 1 = strongly pressure driven */
  gain: number;
  minFrac: number;
  opacity: number;
  /** One-Euro filter params for finger input (screen pixels) */
  fingerCutoff: number;
  fingerBeta: number;
  /** One-Euro filter params for stylus input (less lag, stylus is already precise) */
  penCutoff: number;
  penBeta: number;
};

export const PRESETS: Record<InkTool, InkPreset> = {
  pen: { gain: 0.35, minFrac: 0.55, opacity: 1, fingerCutoff: 1.5, fingerBeta: 0.007, penCutoff: 4.0, penBeta: 0.02 },
  fountain: { gain: 0.9, minFrac: 0.22, opacity: 1, fingerCutoff: 1.5, fingerBeta: 0.007, penCutoff: 4.0, penBeta: 0.02 },
  pencil: { gain: 0.5, minFrac: 0.5, opacity: 0.82, fingerCutoff: 1.5, fingerBeta: 0.007, penCutoff: 4.0, penBeta: 0.02 },
  highlighter: { gain: 0, minFrac: 1, opacity: 0.4, fingerCutoff: 1.2, fingerBeta: 0.005, penCutoff: 3.0, penBeta: 0.015 },
};

export const TOOL_ORDER: ToolId[] = ['pen', 'fountain', 'pencil', 'highlighter', 'eraser', 'shape', 'text', 'select', 'hand'];

export const SIZES: Record<ToolId, number[]> = {
  pen: [1.2, 2, 3.2, 5, 8],
  fountain: [2, 3.5, 5, 7, 10],
  pencil: [1, 1.8, 2.8, 4, 6],
  highlighter: [10, 14, 20, 28],
  eraser: [10, 18, 30],
  shape: [1.5, 3, 5, 8],
  text: [14, 18, 24, 32, 44],
  select: [],
  hand: [],
};

export const DEFAULT_SIZE: Record<ToolId, number> = {
  pen: 2,
  fountain: 3.5,
  pencil: 1.8,
  highlighter: 14,
  eraser: 18,
  shape: 3,
  text: 18,
  select: 0,
  hand: 0,
};

export const COLORS = [
  '#111111',
  '#E53935',
  '#FB8C00',
  '#FDD835',
  '#43A047',
  '#1E88E5',
  '#3949AB',
  '#8E24AA',
  '#6D4C41',
  '#FFFFFF',
];

export const HIGHLIGHT_COLORS = ['#FDD835', '#FF8A65', '#81C784', '#4FC3F7', '#F48FB1', '#CE93D8'];

export function isInkTool(t: ToolId): t is InkTool {
  return t === 'pen' || t === 'fountain' || t === 'pencil' || t === 'highlighter';
}
