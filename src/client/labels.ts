import { edgeMarginsOf, type CuttingSettings, type PreflightIssue } from '../engine';
import { fmtNum } from './format';

/** "5 mm" when all edges are trimmed equally, otherwise "üst 5 · sağ 0 · alt 5 · sol 0 mm". */
export function marginText(s: CuttingSettings): string {
  const m = edgeMarginsOf(s);
  if (m.top === m.right && m.right === m.bottom && m.bottom === m.left) return `${fmtNum(m.top)} mm`;
  return `üst ${fmtNum(m.top)} · sağ ${fmtNum(m.right)} · alt ${fmtNum(m.bottom)} · sol ${fmtNum(m.left)} mm`;
}

export const PROFILE_LABEL: Record<string, string> = {
  balanced: 'Dengeli',
  'min-material': 'En az malzeme',
  'min-cost': 'En düşük maliyet',
  'max-offcut': 'En çok artık parça',
  'min-cuts': 'En az kesim',
  'single-stock': 'Tek tabaka türü',
};

export const GRAIN_STOCK_LABEL = { none: 'Belirtilmedi', width: 'Genişlik yönünde', height: 'Yükseklik yönünde' } as const;
export const GRAIN_PIECE_LABEL = { any: 'Fark etmez', width: 'Genişlik yönünde', height: 'Yükseklik yönünde' } as const;

export function issueText(issue: PreflightIssue, name: string): string {
  switch (issue.kind) {
    case 'invalid-dimension':
      return `${name}: ölçüler sıfırdan büyük olmalıdır.`;
    case 'invalid-quantity':
      return `${name}: adet pozitif bir tam sayı olmalıdır.`;
    case 'no-fit':
      return `${name}: uygun kağıt cinsindeki hiçbir stok kaleminden (kenar payı düşüldükten sonra, dönüş kuralları dahil) büyük/uygun değil.`;
    case 'no-material':
      return `${name}: seçilen kağıt cinsinde kullanılabilir stok yok.`;
    case 'no-stock':
      return `${name}: kullanılabilir stok yok.`;
  }
}
