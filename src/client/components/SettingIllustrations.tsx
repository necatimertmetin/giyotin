import type { ReactElement } from 'react';
import { fmtNum } from '../format';

const INK = '#1f2933';

/** Two pieces with the kerf strip between them; the strip's width follows the setting. */
export function KerfIllustration({ kerf }: { kerf: number }): ReactElement {
  const strip = Math.min(60, Math.max(3, kerf * 8));
  const gap = 200 - strip / 2;
  return (
    <svg viewBox="0 0 400 130" width="100%" role="img" aria-label={`Bıçak payı çizimi: iki parça arasında ${fmtNum(kerf)} milimetrelik şerit`}>
      <rect x="10" y="38" width={gap - 10} height="84" fill="#cfe7f7" stroke={INK} strokeWidth="2" />
      <rect x={200 + strip / 2} y="38" width={gap - 10} height="84" fill="#cfe7f7" stroke={INK} strokeWidth="2" />
      <rect x={gap} y="38" width={strip} height="84" fill={INK} />
      <text x={(gap + 10) / 2} y="86" textAnchor="middle" fontSize="14" fontWeight="700" fill="#111827">Parça A</text>
      <text x={(400 - 10 + 200 + strip / 2) / 2} y="86" textAnchor="middle" fontSize="14" fontWeight="700" fill="#111827">Parça B</text>
      <path d="M200 4 L200 30" stroke="#c2410c" strokeWidth="3" strokeDasharray="5 3" />
      <path d="M190 22 L200 34 L210 22" fill="none" stroke="#c2410c" strokeWidth="3" />
      <text x="218" y="18" fontSize="13" fontWeight="700" fill="#c2410c">kesim çizgisi · {fmtNum(kerf)} mm</text>
    </svg>
  );
}

/** Sheet with the trimmed edge band; band thickness follows the setting. */
export function MarginIllustration({ margin }: { margin: number }): ReactElement {
  const band = margin > 0 ? Math.min(26, 6 + margin * 2) : 0;
  return (
    <svg viewBox="0 0 400 130" width="100%" role="img" aria-label={margin > 0 ? `Kenar payı çizimi: her kenardan ${fmtNum(margin)} milimetre kırpılır` : 'Kenar kırpma yok'}>
      <rect x="110" y="6" width="180" height="118" fill={margin > 0 ? '#f3d9d6' : '#fff'} stroke={INK} strokeWidth="2" />
      <rect x={110 + band} y={6 + band} width={180 - 2 * band} height={118 - 2 * band} fill="#fff" stroke={margin > 0 ? '#6b7280' : 'none'} strokeDasharray="5 3" />
      <rect x={124 + band} y={20 + band} width="62" height="40" fill="#cfe7f7" stroke={INK} />
      <rect x={194 + band} y={20 + band} width="62" height="40" fill="#cfe7f7" stroke={INK} />
      {margin > 0 ? (
        <>
          <text x="40" y="58" fontSize="13" fontWeight="700" fill="#7f1d1d">atılan</text>
          <text x="40" y="74" fontSize="13" fontWeight="700" fill="#7f1d1d">şerit</text>
          <path d="M84 66 L112 66" stroke="#7f1d1d" strokeWidth="1.5" />
        </>
      ) : (
        <text x="200" y="104" textAnchor="middle" fontSize="13" fill="#4b5563">kenarlar olduğu gibi kullanılır</text>
      )}
    </svg>
  );
}

/** Kept offcut (green) versus waste (red). */
export function OffcutIllustration({ w, h }: { w: number; h: number }): ReactElement {
  return (
    <svg viewBox="0 0 400 130" width="100%" role="img" aria-label="Artık ve fire çizimi">
      <rect x="10" y="6" width="380" height="118" fill="#fff" stroke={INK} strokeWidth="2" />
      <rect x="10" y="6" width="150" height="118" fill="#cfe7f7" stroke={INK} />
      <text x="85" y="70" textAnchor="middle" fontSize="14" fontWeight="700">Siparişler</text>
      <rect x="160" y="6" width="230" height="78" fill="#d7f0e4" stroke="#2f855a" strokeWidth="2" strokeDasharray="6 4" />
      <text x="275" y="40" textAnchor="middle" fontSize="14" fontWeight="700" fill="#14532d">ARTIK · saklanır</text>
      <text x="275" y="58" textAnchor="middle" fontSize="12" fill="#14532d">her kenar ≥ {fmtNum(Math.min(w, h))} mm</text>
      <rect x="160" y="84" width="230" height="40" fill="#f3d9d6" stroke="#b4463c" strokeWidth="2" strokeDasharray="6 4" />
      <text x="275" y="108" textAnchor="middle" fontSize="13" fontWeight="700" fill="#7f1d1d">FİRE · çok küçük</text>
    </svg>
  );
}
