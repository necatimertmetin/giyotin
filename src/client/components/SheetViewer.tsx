import { Box, FormControlLabel, IconButton, Stack, Switch, Tooltip, Typography } from '@mui/material';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import ScreenRotationIcon from '@mui/icons-material/ScreenRotation';
import { useCallback, useId, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode, type CSSProperties } from 'react';
import { collectCuts, collectPieces, collectRemnants, type CutNode, type SheetPlan, type TreeNode } from '../../engine';
import { ACCENT, FONT_MONO } from '../theme';
import { fmtNum } from '../format';
import type { PieceInfo, Selection } from './viewerTypes';
import { computeShifts, splitLayout } from './splitOffsets';

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  sheet: SheetPlan;
  pieces: Map<string, PieceInfo>;
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  /** Step mode: number of cuts already made (0..n). null = overview of the finished layout. */
  step?: number | null;
  /** Controls pinned to the top-left corner of the preview (below the zoom buttons). */
  overlay?: ReactNode;
  height?: number | string;
  /** Compact thumbnail without controls or interaction. */
  thumbnail?: boolean;
}

const INK = '#1f2933';

const sameNode = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export function SheetViewer({ sheet, pieces, selection, onSelect, step = null, overlay, height = 'min(72vh, 720px)', thumbnail = false }: Props): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [vb, setVb] = useState<ViewBox | null>(null);
  const [showKerf, setShowKerf] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showNumbers, setShowNumbers] = useState(true);
  const drag = useRef<{ x: number; y: number; vb: ViewBox; moved: boolean } | null>(null);

  const W = sheet.width;
  const H = sheet.height;
  // The sheet is shown with its long side horizontal by default (wide screens waste less space); the user can turn it back.
  const [sideways, setSideways] = useState(() => !thumbnail && H > W);
  const rot = sideways && !thumbnail;
  const DW = rot ? H : W; // displayed width / height
  const DH = rot ? W : H;
  const unrot = (cx: number, cy: number): string | undefined => (rot ? `rotate(-90 ${cx} ${cy})` : undefined);
  /** A point `off` below the centre as seen on screen (in the turned sheet that is along the original x axis). */
  const below = (cx: number, cy: number, off: number): { x: number; y: number } => (rot ? { x: cx + off, y: cy } : { x: cx, y: cy + off });

  const cuts = useMemo(() => collectCuts(sheet.tree), [sheet.tree]);
  const pieceNodes = useMemo(() => collectPieces(sheet.tree), [sheet.tree]);
  const remnants = useMemo(() => collectRemnants(sheet.tree), [sheet.tree]);

  // In step mode the pieces glide apart, so the view has to fit the fully separated layout.
  const split = useMemo(() => splitLayout(sheet.tree, W, H), [sheet.tree, W, H]);
  const animated = step !== null && !thumbnail;
  const ox0 = animated ? split.bounds.x0 : 0;
  const oy0 = animated ? split.bounds.y0 : 0;
  const ox1 = animated ? split.bounds.x1 : W;
  const oy1 = animated ? split.bounds.y1 : H;
  // Turning the sheet 90° clockwise maps (x, y) to (H - y, x).
  const bx0 = rot ? H - oy1 : ox0;
  const bx1 = rot ? H - oy0 : ox1;
  const by0 = rot ? ox0 : oy0;
  const by1 = rot ? ox1 : oy1;

  const fitBox = useCallback(
    (cw: number, ch: number): ViewBox => {
      // The controls sit in columns at both sides, so they get their own margin instead of covering the sheet.
      const side = thumbnail ? 0.02 * cw : 128;
      const vert = thumbnail ? 0.02 * ch : 40;
      const bw = Math.max(bx1 - bx0, 1);
      const bh = Math.max(by1 - by0, 1);
      const k = Math.max(0.01, Math.min((cw - 2 * side) / bw, (ch - 2 * vert) / bh));
      const w = cw / k;
      const h = ch / k;
      return { x: (bx0 + bx1) / 2 - w / 2, y: (by0 + by1) / 2 - h / 2, w, h };
    },
    [bx0, by0, bx1, by1, thumbnail],
  );

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const apply = (): void => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit whenever the sheet or the container changes shape.
  useEffect(() => {
    setVb(fitBox(size.w, size.h));
  }, [fitBox, size.w, size.h, sheet]);

  const view = vb ?? fitBox(size.w, size.h);
  const scale = size.w / view.w; // px per mm

  const zoomAt = useCallback(
    (factor: number, cx?: number, cy?: number) => {
      setVb((cur) => {
        const base = cur ?? fitBox(size.w, size.h);
        const fit = fitBox(size.w, size.h);
        const w = Math.min(fit.w * 4, Math.max(15, base.w / factor));
        const k = w / base.w;
        const px = cx ?? base.x + base.w / 2;
        const py = cy ?? base.y + base.h / 2;
        return { x: px - (px - base.x) * k, y: py - (py - base.y) * k, w, h: base.h * k };
      });
    },
    [fitBox, size.w, size.h],
  );

  // Wheel zoom needs a non-passive listener.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || thumbnail) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      setVb((cur) => {
        const base = cur ?? fitBox(size.w, size.h);
        const fit = fitBox(size.w, size.h);
        const factor = Math.exp(-e.deltaY * 0.0015);
        const w = Math.min(fit.w * 4, Math.max(15, base.w / factor));
        const k = w / base.w;
        const px = base.x + ((e.clientX - rect.left) / rect.width) * base.w;
        const py = base.y + ((e.clientY - rect.top) / rect.height) * base.h;
        return { x: px - (px - base.x) * k, y: py - (py - base.y) * k, w, h: base.h * k };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [fitBox, size.w, size.h, thumbnail]);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (thumbnail) return;
    drag.current = { x: e.clientX, y: e.clientY, vb: view, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    // Capture only once a real drag starts, so plain clicks still reach the clicked piece or cut.
    if (!d.moved) e.currentTarget.setPointerCapture(e.pointerId);
    d.moved = true;
    const k = d.vb.w / size.w;
    setVb({ ...d.vb, x: d.vb.x - dx * k, y: d.vb.y - dy * k });
  };
  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d && !d.moved && (e.target as Element) === svgRef.current) onSelect(null);
    // Keep `moved` readable for the click event that follows a drag, then reset.
    if (d?.moved) setTimeout(() => { drag.current = null; }, 0);
    else drag.current = null;
  };
  const select = (sel: Selection) => (e: { stopPropagation: () => void }): void => {
    if (drag.current?.moved) return;
    e.stopPropagation();
    onSelect(sel);
  };

  const px = (n: number): number => n / scale; // screen px -> mm
  // Pattern ids must be unique per viewer: several viewers are mounted at once (a hidden one would win a shared id).
  const uid = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const stepMode = animated;
  const currentCut: CutNode | undefined = stepMode && step > 0 ? cuts[step - 1] : undefined;
  // While the pieces move apart only the cut being made is drawn; the finished layout shows every cut line.
  const visibleCuts = stepMode ? (currentCut ? [currentCut] : []) : cuts;
  const shifts = useMemo(() => (stepMode ? computeShifts(sheet.tree, step ?? 0, split.gap) : null), [stepMode, sheet.tree, step, split.gap]);
  const moveStyle = (node: TreeNode): CSSProperties | undefined => {
    const sh = shifts?.get(node);
    return sh ? { transform: `translate(${sh.dx}px, ${sh.dy}px)`, transition: 'transform 520ms cubic-bezier(0.2, 0.7, 0.2, 1)' } : undefined;
  };
  const selectedCut = selection?.kind === 'cut' ? selection.node : null;
  const trim = Math.max(sheet.usable.x, 0);

  const miniScale = 120 / Math.max(DW, DH);

  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        ref={containerRef}
        sx={{
          height,
          width: '100%',
          bgcolor: '#e4e7ec',
          backgroundImage: 'linear-gradient(#d4d8df 1px, transparent 1px), linear-gradient(90deg, #d4d8df 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          overflow: 'hidden',
          touchAction: 'none',
          cursor: thumbnail ? 'default' : drag.current?.moved ? 'grabbing' : 'grab',
        }}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          role="img"
          aria-label={`Kesim planı: ${fmtNum(W)} × ${fmtNum(H)} mm kalıp`}
          style={{ display: 'block', userSelect: 'none' }}
          data-testid={thumbnail ? "sheet-thumb" : "sheet-svg"}
        >
          <defs>
            <pattern id={`${uid}-offcut`} patternUnits="userSpaceOnUse" width={px(9)} height={px(9)} patternTransform="rotate(45)">
              <rect width={px(9)} height={px(9)} fill="#d7f0e4" />
              <line x1="0" y1="0" x2="0" y2={px(9)} stroke="#2f855a" strokeWidth={px(2)} />
            </pattern>
            <pattern id={`${uid}-waste`} patternUnits="userSpaceOnUse" width={px(8)} height={px(8)}>
              <rect width={px(8)} height={px(8)} fill="#f3d9d6" />
              <path d={`M0 0L${px(8)} ${px(8)}M${px(8)} 0L0 ${px(8)}`} stroke="#b4463c" strokeWidth={px(1)} />
            </pattern>
            <pattern id={`${uid}-trim`} patternUnits="userSpaceOnUse" width={px(6)} height={px(6)} patternTransform="rotate(-45)">
              <rect width={px(6)} height={px(6)} fill="#f4f5f7" />
              <line x1="0" y1="0" x2="0" y2={px(6)} stroke="#9aa3af" strokeWidth={px(1)} />
            </pattern>
          </defs>

          <g transform={rot ? `translate(${H} 0) rotate(90)` : undefined}>
          {/* Sheet body */}
          {stepMode ? (
            <rect x={0} y={0} width={W} height={H} fill="none" stroke="#6b7280" strokeDasharray="6 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ) : (
            <>
              <rect x={0} y={0} width={W} height={H} fill={`url(#${uid}-trim)`} stroke={INK} strokeWidth={2} vectorEffect="non-scaling-stroke" />
              {trim > 0 && <rect x={sheet.usable.x} y={sheet.usable.y} width={sheet.usable.w} height={sheet.usable.h} fill="#fff" stroke="#6b7280" strokeDasharray="6 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
              {trim === 0 && <rect x={0} y={0} width={W} height={H} fill="#fff" />}
            </>
          )}

          {/* Remnants */}
          {remnants.map((n, i) => (
            <g key={`r${i}`} style={moveStyle(n)}>
              <rect
                x={n.x}
                y={n.y}
                width={n.w}
                height={n.h}
                fill={n.type === 'offcut' ? `url(#${uid}-offcut)` : `url(#${uid}-waste)`}
                stroke={n.type === 'offcut' ? '#2f855a' : '#b4463c'}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: thumbnail ? 'default' : 'pointer' }}
                onClick={thumbnail ? undefined : select({ kind: 'remnant', node: n })}
              >
                <title>{n.type === 'offcut' ? `Yeniden kullanılabilir artık: ${fmtNum(n.w)} × ${fmtNum(n.h)} mm` : `Kullanılamaz fire: ${fmtNum(n.w)} × ${fmtNum(n.h)} mm`}</title>
              </rect>
              {showLabels && !thumbnail && (rot ? n.h : n.w) * scale > 78 && (rot ? n.w : n.h) * scale > 30 && (
                <text transform={unrot(n.x + n.w / 2, n.y + n.h / 2)} x={n.x + n.w / 2} y={n.y + n.h / 2} textAnchor="middle" dominantBaseline="central" fontSize={px(11)} fill={n.type === 'offcut' ? '#14532d' : '#7f1d1d'} fontWeight={700} fontFamily={FONT_MONO} pointerEvents="none" style={{ paintOrder: 'stroke' }} stroke="#ffffffcc" strokeWidth={px(3)}>
                  {n.type === 'offcut' ? 'ARTIK' : 'FİRE'} {fmtNum(n.w, 0)}×{fmtNum(n.h, 0)}
                </text>
              )}
            </g>
          ))}

          {/* Finished pieces */}
          {pieceNodes.map((n, i) => {
            const info = pieces.get(n.pieceId);
            const isSel = selection?.kind === 'piece' && sameNode(selection.node, n);
            const sw = (rot ? n.h : n.w) * scale;
            const sh = (rot ? n.w : n.h) * scale;
            const label = showLabels && !thumbnail;
            const fs = Math.min(26, Math.max(10, Math.min(sw / 7, sh / 4)));
            // The product name is written on the piece; it shrinks, then is cut short, then falls back to the letter code.
            const fullName = info?.name ?? '?';
            let nameFs = Math.min(fs, (sw - 8) / (fullName.length * 0.6));
            let pieceLabel = fullName;
            if (nameFs < 9) {
              nameFs = 9;
              const maxChars = Math.floor((sw - 8) / (9 * 0.6));
              pieceLabel = maxChars >= 3 ? `${fullName.slice(0, maxChars - 1)}…` : (info?.code ?? '?');
            }
            const nameAt = below(n.x + n.w / 2, n.y + n.h / 2, -(sw > 46 && sh > 28 ? px(nameFs * 0.6) : 0));
            const dimsAt = below(n.x + n.w / 2, n.y + n.h / 2, px(nameFs * 0.75));
            return (
              <g key={`p${i}`} style={moveStyle(n)}>
                <rect
                  x={n.x}
                  y={n.y}
                  width={n.w}
                  height={n.h}
                  fill={info?.fill ?? '#cbd5e1'}
                  stroke={info?.stroke ?? INK}
                  strokeWidth={isSel ? 3 : 1}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: thumbnail ? 'default' : 'pointer' }}
                  onClick={thumbnail ? undefined : select({ kind: 'piece', node: n })}
                >
                  <title>{`${info?.name ?? n.pieceId}: ${fmtNum(n.w)} × ${fmtNum(n.h)} mm${n.rotated ? ' (90° döndürülmüş)' : ''}`}</title>
                </rect>
                {isSel && <rect x={n.x} y={n.y} width={n.w} height={n.h} fill="none" stroke={ACCENT} strokeWidth={3} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
                {label && sw > 22 && sh > 14 && (
                  <text transform={unrot(nameAt.x, nameAt.y)} x={nameAt.x} y={nameAt.y} textAnchor="middle" dominantBaseline="central" fontSize={px(nameFs)} fontWeight={700} fill="#111827" pointerEvents="none" fontFamily={FONT_MONO}>
                    {pieceLabel}
                    {n.rotated && sw - 8 >= (pieceLabel.length + 2) * nameFs * 0.62 ? ' ↻' : ''}
                  </text>
                )}
                {label && sw > 46 && sh > 28 && (
                  <text transform={unrot(dimsAt.x, dimsAt.y)} x={dimsAt.x} y={dimsAt.y} textAnchor="middle" dominantBaseline="central" fontSize={px(Math.max(9, nameFs * 0.8))} fill="#1f2933" pointerEvents="none" fontFamily={FONT_MONO}>
                    {fmtNum(n.w, 0)}×{fmtNum(n.h, 0)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Highlight of the region being cut (step mode) or of the selected cut */}
          {selectedCut && (
            <g pointerEvents="none">
              <rect x={selectedCut.x} y={selectedCut.y} width={selectedCut.w} height={selectedCut.h} fill={ACCENT} fillOpacity={0.1} stroke={ACCENT} strokeWidth={2} strokeDasharray="8 5" vectorEffect="non-scaling-stroke" />
            </g>
          )}

          {/* Kerf strips and cut lines */}
          {visibleCuts.map((c) => {
            const vertical = c.direction === 'vertical';
            const x = vertical ? c.x + c.position : c.x;
            const y = vertical ? c.y : c.y + c.position;
            const kw = vertical ? c.kerf : c.w;
            const kh = vertical ? c.h : c.kerf;
            const lineX1 = vertical ? x + c.kerf / 2 : c.x;
            const lineX2 = vertical ? x + c.kerf / 2 : c.x + c.w;
            const lineY1 = vertical ? c.y : y + c.kerf / 2;
            const lineY2 = vertical ? c.y + c.h : y + c.kerf / 2;
            const isCurrent = currentCut?.sequence === c.sequence;
            const isSelCut = selectedCut?.sequence === c.sequence;
            const lengthPx = (vertical ? c.h : c.w) * scale;
            const emphasized = isCurrent || isSelCut;
            return (
              <g key={`c${c.sequence}`} style={moveStyle(c)}>
                {showKerf && !stepMode && kw > 0 && kh > 0 && <rect x={x} y={y} width={kw} height={kh} fill={INK} fillOpacity={0.9} pointerEvents="none" />}
                <line x1={lineX1} y1={lineY1} x2={lineX2} y2={lineY2} stroke={emphasized ? '#f59e0b' : ACCENT} strokeWidth={emphasized ? 3.5 : 1.25} strokeDasharray={emphasized ? undefined : '5 3'} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                {!thumbnail && <line x1={lineX1} y1={lineY1} x2={lineX2} y2={lineY2} stroke="transparent" strokeWidth={12} vectorEffect="non-scaling-stroke" style={{ cursor: 'pointer' }} onClick={select({ kind: 'cut', node: c })}>
                  <title>{`Kesim #${c.sequence} — ${vertical ? 'dikey' : 'yatay'}, kerf ${fmtNum(c.kerf)} mm`}</title>
                </line>}
                {showNumbers && !thumbnail && (emphasized || lengthPx > 44) && (
                  <g pointerEvents="none">
                    <circle cx={vertical ? lineX1 : c.x + px(11)} cy={vertical ? c.y + px(11) : lineY1} r={px(9)} fill={emphasized ? '#f59e0b' : ACCENT} stroke="#fff" strokeWidth={px(1.2)} />
                    <text transform={unrot(vertical ? lineX1 : c.x + px(11), vertical ? c.y + px(11) : lineY1)} x={vertical ? lineX1 : c.x + px(11)} y={vertical ? c.y + px(11) : lineY1} textAnchor="middle" dominantBaseline="central" fontSize={px(c.sequence > 99 ? 7 : 9)} fontWeight={700} fill={emphasized ? '#111827' : '#fff'} fontFamily={FONT_MONO}>
                      {c.sequence}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          </g>

          {/* Dimension annotations */}
          {!thumbnail && (
            <g fontFamily={FONT_MONO} fill={INK} pointerEvents="none">
              <line x1={0} y1={-px(14)} x2={DW} y2={-px(14)} stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <line x1={0} y1={-px(19)} x2={0} y2={-px(9)} stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <line x1={DW} y1={-px(19)} x2={DW} y2={-px(9)} stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <text x={DW / 2} y={-px(20)} textAnchor="middle" fontSize={px(12)} fontWeight={700}>{fmtNum(DW)} mm</text>
              <line x1={-px(14)} y1={0} x2={-px(14)} y2={DH} stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <line x1={-px(19)} y1={0} x2={-px(9)} y2={0} stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <line x1={-px(19)} y1={DH} x2={-px(9)} y2={DH} stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
              <text x={-px(20)} y={DH / 2} textAnchor="middle" fontSize={px(12)} fontWeight={700} transform={`rotate(-90 ${-px(20)} ${DH / 2})`}>{fmtNum(DH)} mm</text>
            </g>
          )}
        </svg>
      </Box>

      {!thumbnail && (
        <>
          <Box sx={{ position: 'absolute', top: 8, left: 8, display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
            <Stack direction="column" spacing={0.25} sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 0.25 }}>
              <Tooltip title="Yakınlaştır" placement="right"><IconButton size="small" aria-label="Yakınlaştır" onClick={() => zoomAt(1.35)}><ZoomInIcon fontSize="small" /></IconButton></Tooltip>
              <Tooltip title="Uzaklaştır" placement="right"><IconButton size="small" aria-label="Uzaklaştır" onClick={() => zoomAt(1 / 1.35)}><ZoomOutIcon fontSize="small" /></IconButton></Tooltip>
              <Tooltip title={rot ? 'Dik göster' : 'Yan çevir'} placement="right"><IconButton size="small" aria-label="Görünümü çevir" color={rot ? 'primary' : 'default'} onClick={() => setSideways((v) => !v)} data-testid="rotate-view"><ScreenRotationIcon fontSize="small" /></IconButton></Tooltip>
              <Tooltip title="Ekrana sığdır" placement="right"><IconButton size="small" aria-label="Ekrana sığdır" onClick={() => setVb(fitBox(size.w, size.h))}><FitScreenIcon fontSize="small" /></IconButton></Tooltip>
            </Stack>
            {overlay}
          </Box>
          <Stack direction="column" spacing={0} sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 1, py: 0.25, alignItems: 'flex-start' }}>
            <FormControlLabel control={<Switch size="small" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />} label={<Typography variant="caption">Etiket</Typography>} />
            <FormControlLabel control={<Switch size="small" checked={showNumbers} onChange={(e) => setShowNumbers(e.target.checked)} />} label={<Typography variant="caption">Kesim no</Typography>} />
            <FormControlLabel control={<Switch size="small" checked={showKerf} onChange={(e) => setShowKerf(e.target.checked)} />} label={<Typography variant="caption">Kerf</Typography>} />
          </Stack>
          <Box
            data-testid="minimap"
            sx={{ position: 'absolute', bottom: 8, right: 8, width: DW * miniScale + 8, height: DH * miniScale + 8, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: '3px', cursor: 'crosshair' }}
            onPointerDown={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const mx = ((e.clientX - rect.left - 4) / (DW * miniScale)) * DW;
              const my = ((e.clientY - rect.top - 4) / (DH * miniScale)) * DH;
              setVb({ ...view, x: mx - view.w / 2, y: my - view.h / 2 });
            }}
          >
            <svg width={DW * miniScale + 2} height={DH * miniScale + 2} viewBox={`-1 -1 ${DW + 2} ${DH + 2}`} aria-label="Genel bakış">
              <g transform={rot ? `translate(${H} 0) rotate(90)` : undefined}>
              <rect x={0} y={0} width={W} height={H} fill="#fff" stroke={INK} strokeWidth={2} vectorEffect="non-scaling-stroke" />
              {pieceNodes.slice(0, 700).map((n, i) => (
                <rect key={i} x={n.x} y={n.y} width={n.w} height={n.h} fill={pieces.get(n.pieceId)?.fill ?? '#cbd5e1'} />
              ))}
              {remnants.map((n, i) => (
                <rect key={`r${i}`} x={n.x} y={n.y} width={n.w} height={n.h} fill={n.type === 'offcut' ? '#9ad7b8' : '#e8b4ae'} />
              ))}
              </g>
              <rect x={view.x} y={view.y} width={view.w} height={view.h} fill={ACCENT} fillOpacity={0.12} stroke={ACCENT} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            </svg>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ position: 'absolute', bottom: 10, left: 12, bgcolor: 'rgba(255,255,255,0.85)', px: 0.75, borderRadius: 0.5, fontFamily: FONT_MONO }}>
            {fmtNum(scale * 10, 1)} px/cm<br />tekerlek: yakınlaştır<br />sürükle: kaydır
          </Typography>
        </>
      )}
    </Box>
  );
}
