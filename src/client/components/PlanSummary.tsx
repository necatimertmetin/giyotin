import { Box, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useMemo, type ReactElement } from 'react';
import { collectPieces, cutSteps, type Plan } from '../../engine';
import { fmtInt, fmtNum, fmtPercent } from '../format';
import { FONT_MONO } from '../theme';
import type { PieceInfo } from './viewerTypes';

interface Props {
  plan: Plan;
  pieces: Map<string, PieceInfo>;
  /** Layout shown in the viewer; its column is highlighted. */
  current: number;
  onSelect: (index: number) => void;
}

const mono = { fontFamily: FONT_MONO } as const;

/**
 * The whole plan on one screen, for the print shop: how many different layouts, how many sheets of each and in
 * total, and per product how many pieces every layout holds, how many are cut in all and how that meets the order.
 */
export function PlanSummary({ plan, pieces, current, onSelect }: Props): ReactElement {
  const perSheet = useMemo(
    () =>
      plan.sheets.map((sheet) => {
        const m = new Map<string, number>();
        for (const p of collectPieces(sheet.tree)) m.set(p.pieceId, (m.get(p.pieceId) ?? 0) + 1);
        return m;
      }),
    [plan],
  );
  const products = [...pieces.values()].filter((p) => p.quantity > 0 || (plan.placed[p.id] ?? 0) > 0);
  const totalPieces = plan.sheets.reduce((a, s, i) => a + s.copies * [...perSheet[i]!.values()].reduce((x, n) => x + n, 0), 0);
  const hl = (i: number) => (i === current ? { bgcolor: 'action.selected' } : {});
  const layoutCell = (i: number) => ({ cursor: 'pointer', ...hl(i) });

  return (
    <Stack spacing={2} data-testid="plan-summary">
      <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
        <Fact label="Kalıp çeşidi" value={fmtInt(plan.sheets.length)} />
        <Fact label="Toplam tabaka" value={fmtInt(plan.totals.sheetCount)} />
        <Fact label="Toplam parça" value={fmtInt(totalPieces)} />
        <Fact label="Kesim adımı" value={fmtInt(cutSteps(plan))} hint="her kalıp bir kez, istif halinde" />
        <Fact label="Kağıt kullanımı" value={fmtPercent(plan.totals.utilization)} />
      </Stack>

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Kalıplar</Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Kalıp</TableCell>
                <TableCell>Kağıt</TableCell>
                <TableCell align="right">Tabaka</TableCell>
                <TableCell align="right">Tabakada parça</TableCell>
                <TableCell align="right">Kesim</TableCell>
                <TableCell align="right">Toplam parça</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {plan.sheets.map((s, i) => {
                const n = [...perSheet[i]!.values()].reduce((a, x) => a + x, 0);
                return (
                  <TableRow key={i} hover onClick={() => onSelect(i)} sx={layoutCell(i)} data-testid={`summary-layout-${i}`}>
                    <TableCell sx={{ fontWeight: 700 }}>Kalıp {i + 1}</TableCell>
                    <TableCell>{s.stockName}<Typography component="span" variant="caption" color="text.secondary"> · {fmtNum(s.width, 0)}×{fmtNum(s.height, 0)} mm</Typography></TableCell>
                    <TableCell align="right" sx={{ ...mono, fontWeight: 700 }}>{fmtInt(s.copies)}</TableCell>
                    <TableCell align="right" sx={mono}>{fmtInt(n)}</TableCell>
                    <TableCell align="right" sx={mono}>{fmtInt(s.stats.cuts)}</TableCell>
                    <TableCell align="right" sx={mono}>{fmtInt(n * s.copies)}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow>
                <TableCell colSpan={2} sx={{ fontWeight: 700 }}>Toplam</TableCell>
                <TableCell align="right" sx={{ ...mono, fontWeight: 700 }}>{fmtInt(plan.totals.sheetCount)}</TableCell>
                <TableCell />
                <TableCell align="right" sx={mono}>{fmtInt(cutSteps(plan))}</TableCell>
                <TableCell align="right" sx={mono}>{fmtInt(totalPieces)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      <Box>
        <Typography variant="subtitle2">Ürünler ve kalıplar</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          Kalıp sütunlarında bir tabakada kaç tane çıktığı yazar; toplam = Σ (tabakada adet × tabaka sayısı).
        </Typography>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ '& td, & th': { whiteSpace: 'nowrap' } }}>
            <TableHead>
              <TableRow>
                <TableCell>Ürün</TableCell>
                {plan.sheets.map((s, i) => (
                  <TableCell key={i} align="right" onClick={() => onSelect(i)} sx={layoutCell(i)}>
                    Kalıp {i + 1}
                    <Typography variant="caption" display="block" color="text.secondary">×{fmtInt(s.copies)} tabaka</Typography>
                  </TableCell>
                ))}
                <TableCell align="right">Kesilen</TableCell>
                <TableCell align="right">Sipariş</TableCell>
                <TableCell align="right">Fark</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {products.map((p) => {
                const placed = plan.placed[p.id] ?? 0;
                const diff = placed - p.quantity;
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Box component="span" sx={{ display: 'inline-block', width: 12, height: 12, bgcolor: p.fill, border: `1px solid ${p.stroke}`, mr: 0.75, verticalAlign: -1 }} />
                      <Box component="span" sx={{ ...mono, mr: 1 }}>{p.code}</Box>
                      {p.name}
                      <Typography component="span" variant="caption" color="text.secondary"> · {fmtNum(p.width)}×{fmtNum(p.height)}</Typography>
                    </TableCell>
                    {plan.sheets.map((_, i) => {
                      const n = perSheet[i]!.get(p.id) ?? 0;
                      return <TableCell key={i} align="right" sx={{ ...mono, ...hl(i), color: n ? 'text.primary' : 'text.disabled' }}>{n ? fmtInt(n) : '—'}</TableCell>;
                    })}
                    <TableCell align="right" sx={{ ...mono, fontWeight: 700 }}>{fmtInt(placed)}</TableCell>
                    <TableCell align="right" sx={mono}>{fmtInt(p.quantity)}</TableCell>
                    <TableCell align="right" sx={{ ...mono, color: diff < 0 ? 'error.main' : diff > 0 ? 'warning.dark' : 'success.main' }}>
                      {diff === 0 ? 'tam' : diff > 0 ? `+${fmtInt(diff)} fazla` : `${fmtInt(-diff)} eksik`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    </Stack>
  );
}

function Fact({ label, value, hint }: { label: string; value: string; hint?: string }): ReactElement {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h6" sx={{ ...mono, lineHeight: 1.2 }}>{value}</Typography>
      {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
    </Box>
  );
}
