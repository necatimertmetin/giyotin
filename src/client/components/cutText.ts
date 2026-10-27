import { cutGeometry, toMm, toUnits, type CutNode, type SheetPlan } from '../../engine';
import { fmtDims, fmtNum } from '../format';

export interface CutDescription {
  title: string;
  instruction: string;
  /** Regions produced by the cut, as text. */
  results: string[];
  /** Distance of the blade from the sheet edge (absolute), mm. */
  absolute: number;
}

/** Plain-language instruction for one cut, derived from the cut node itself. */
export function describeCut(cut: CutNode, kerfSetting: number): CutDescription {
  const vertical = cut.direction === 'vertical';
  const absolute = vertical ? cut.x + cut.position : cut.y + cut.position;
  const geo = cutGeometry(
    { x: toUnits(cut.x), y: toUnits(cut.y), w: toUnits(cut.w), h: toUnits(cut.h) },
    cut.direction,
    toUnits(cut.position),
    toUnits(kerfSetting),
  );
  const results = [`${vertical ? 'Sol' : 'Üst'} parça: ${fmtDims(toMm(geo.first.w), toMm(geo.first.h))}`];
  if (geo.second) results.push(`${vertical ? 'Sağ' : 'Alt'} parça: ${fmtDims(toMm(geo.second.w), toMm(geo.second.h))}`);
  else results.push('Kalan şerit tamamen bıçak payına gitti (ikinci parça oluşmaz).');
  return {
    title: `${vertical ? 'Dikey' : 'Yatay'} kesim`,
    instruction: `${fmtDims(cut.w, cut.h)} ölçüsündeki parçayı ${vertical ? 'sol' : 'üst'} kenardan ${fmtNum(cut.position)} mm içeriden ${vertical ? 'dikey' : 'yatay'} olarak kesin (tabaka ${vertical ? 'sol' : 'üst'} kenarından ${fmtNum(absolute)} mm).`,
    results,
    absolute,
  };
}

export const sheetLabel = (sheet: SheetPlan, index: number): string =>
  `Kalıp ${index + 1} · ${fmtNum(sheet.width)}×${fmtNum(sheet.height)}${sheet.copies > 1 ? ` · ×${sheet.copies} tabaka` : ''}`;
