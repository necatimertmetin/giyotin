export interface PaperPreset {
  name: string;
  group: 'ISO A' | 'ISO B' | 'Kuzey Amerika';
  width: number;
  height: number;
}

const a: Array<[number, number]> = [
  [841, 1189], [594, 841], [420, 594], [297, 420], [210, 297], [148, 210],
  [105, 148], [74, 105], [52, 74], [37, 52], [26, 37],
];
const b: Array<[number, number]> = [
  [1000, 1414], [707, 1000], [500, 707], [353, 500], [250, 353], [176, 250],
  [125, 176], [88, 125], [62, 88], [44, 62], [31, 44],
];

/** Standard paper formats in millimetres (width × height, portrait). */
export const PAPER_PRESETS: PaperPreset[] = [
  ...a.map(([width, height], i): PaperPreset => ({ name: `A${i}`, group: 'ISO A', width, height })),
  ...b.map(([width, height], i): PaperPreset => ({ name: `B${i}`, group: 'ISO B', width, height })),
  { name: 'US Letter', group: 'Kuzey Amerika', width: 215.9, height: 279.4 },
  { name: 'US Legal', group: 'Kuzey Amerika', width: 215.9, height: 355.6 },
  { name: 'US Tabloid / Ledger', group: 'Kuzey Amerika', width: 279.4, height: 431.8 },
  { name: 'US Executive', group: 'Kuzey Amerika', width: 184.15, height: 266.7 },
];
