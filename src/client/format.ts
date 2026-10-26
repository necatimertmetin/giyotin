const nf = (max: number, min = 0): Intl.NumberFormat => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: min, maximumFractionDigits: max });

const nf0 = nf(0);
const nf1 = nf(1);
const nf2 = nf(2);

export const fmtInt = (n: number): string => nf0.format(n);
export const fmtNum = (n: number, digits = 2): string => (digits === 0 ? nf0 : digits === 1 ? nf1 : digits === 2 ? nf2 : nf(digits)).format(n);
export const fmtMm = (n: number): string => `${nf2.format(n)} mm`;
export const fmtDims = (w: number, h: number): string => `${nf2.format(w)} × ${nf2.format(h)} mm`;
export const fmtPercent = (ratio: number, digits = 1): string => `%${nf(digits, digits).format(ratio * 100)}`;
export const fmtMoney = (n: number): string => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(n);

/** Area given in mm², shown as cm² or m². */
export function fmtArea(mm2: number): string {
  if (Math.abs(mm2) >= 1_000_000) return `${nf2.format(mm2 / 1_000_000)} m²`;
  return `${nf1.format(mm2 / 100)} cm²`;
}

export const fmtDate = (iso: string): string =>
  new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

export const fmtDuration = (ms: number): string => (ms < 1000 ? `${fmtInt(ms)} ms` : `${nf1.format(ms / 1000)} sn`);

/** Parse user input that may use a decimal comma. Returns NaN for empty/invalid text. */
export function parseNum(text: string): number {
  const t = text.trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return Number.NaN;
  return Number(t);
}
