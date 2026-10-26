import type { ReactElement } from 'react';

/**
 * Giyotin mark: a sheet divided by guillotine cuts into rectangles, one of them in turquoise.
 * The gaps between the cells are the kerf. Designed for dark backgrounds.
 */
export function LogoMark({ size = 32 }: { size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <rect x="14" y="14" width="40" height="92" rx="2.5" fill="#ece9e2" />
      <rect x="58" y="14" width="48" height="34" rx="2.5" fill="#ece9e2" />
      <rect x="58" y="52" width="26" height="54" rx="2.5" fill="#3fe0d0" />
      <rect x="88" y="52" width="18" height="24" rx="2.5" fill="#ece9e2" />
      <rect x="88" y="80" width="18" height="26" rx="2.5" fill="#ece9e2" opacity=".55" />
    </svg>
  );
}
