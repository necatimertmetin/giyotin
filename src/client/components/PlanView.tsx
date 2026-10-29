import { Box, Chip, Divider, Paper, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, Typography } from '@mui/material';
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { collectPieces, type CuttingSettings, type OptimizationInput, type OptimizationResult, type Plan } from '../../engine';
import { useArtworks } from '../hooks';
import { FONT_MONO } from '../theme';
import { fmtArea, fmtInt, fmtNum, fmtPercent } from '../format';
import { CutCaption, CutPlayer } from './CutPlayer';
import { PlanStats } from './PlanStats';
import { SelectionInfo } from './SelectionInfo';
import { SheetViewer } from './SheetViewer';
import { sheetLabel } from './cutText';
import { buildPieceInfo, type Selection } from './viewerTypes';

interface Props {
  plan: Plan;
  input: OptimizationInput;
  settings: CuttingSettings;
  meta?: Pick<OptimizationResult, 'runtimeMs' | 'stoppedBy' | 'nodesExplored'>;
  /** Rendered between the summary and the viewer (confirm buttons, offcut handling, …). */
  actions?: ReactNode;
  /** Put the side panel below the viewer (for narrow containers). */
  stacked?: boolean;
}

/** Cutting plan detail: interactive sheet viewer with a cut animation, the product counts and totals. */
export function PlanView({ plan, input, settings, meta, actions, stacked = false }: Props): ReactElement {
  const artworks = useArtworks(input.pieces.map((p) => p.artworkId));
  const pieces = useMemo(() => buildPieceInfo(input.pieces, artworks), [input.pieces, artworks]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    setSheetIndex(0);
    setSelection(null);
    setStep(null);
  }, [plan]);

  const sheet = plan.sheets[sheetIndex] ?? plan.sheets[0];
  const sheetPieceCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (sheet) for (const p of collectPieces(sheet.tree)) m.set(p.pieceId, (m.get(p.pieceId) ?? 0) + 1);
    return m;
  }, [sheet]);

  if (!sheet) {
    return (
      <Stack spacing={2}>
        <PlanStats plan={plan} input={input} meta={meta} />
        {actions}
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      {/* In the narrow side-by-side layout the cutting view comes first, the totals after it. */}
      <Box sx={{ order: stacked ? 3 : 0 }}><PlanStats plan={plan} input={input} meta={meta} /></Box>
      <Box sx={{ order: stacked ? 1 : 0 }}>{actions}</Box>

      <Paper sx={{ p: 0, order: stacked ? 2 : 0 }}>
        <Tabs
          value={sheetIndex}
          onChange={(_, v: number) => {
            setSheetIndex(v);
            setSelection(null);
            setStep(null);
          }}
          variant="scrollable"
          scrollButtons="auto"
          aria-label="Kalıplar"
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          {plan.sheets.map((s, i) => (
            <Tab key={i} value={i} label={sheetLabel(s, i)} data-testid={`sheet-tab-${i}`} />
          ))}
        </Tabs>

        <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: stacked ? '1fr' : { xs: '1fr', lg: 'minmax(0, 1fr) 360px' }, gap: 2 }}>
          <Box sx={{ minWidth: 0 }}>
            <SheetViewer sheet={sheet} pieces={pieces} selection={selection} onSelect={setSelection} step={step} overlay={<CutPlayer sheet={sheet} step={step} onStep={setStep} />} />
            <CutCaption sheet={sheet} kerf={settings.kerf} step={step} />
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }} alignItems="center">
              <Chip size="small" label={`Kullanım ${fmtPercent(sheet.stats.pieceArea / sheet.stats.sheetArea)}`} color="primary" />
              <Chip size="small" variant="outlined" label={`${fmtInt(sheet.stats.pieceCount)} parça`} />
              <Chip size="small" variant="outlined" label={`${fmtInt(sheet.stats.cuts)} kesim`} />
              <Chip size="small" variant="outlined" label={`Fire ${fmtArea(sheet.stats.wasteArea)}`} />
              <Chip size="small" variant="outlined" label={`Artık ${fmtArea(sheet.stats.offcutArea)}`} />
              {sheet.copies > 1 && <Chip size="small" color="secondary" label={`Bu kalıp ${sheet.copies} tabakada tekrarlanır`} />}
              <Box sx={{ flex: 1 }} />
              <LegendSwatch css="repeating-linear-gradient(45deg,#d7f0e4 0 4px,#2f855a 4px 5px)" label="Artık" />
              <LegendSwatch css="repeating-linear-gradient(45deg,#f3d9d6 0 4px,#b4463c 4px 5px)" label="Fire" />
              <LegendSwatch css="#1f2933" label="Kerf" />
              <LegendSwatch css="repeating-linear-gradient(90deg,#c2410c 0 5px,transparent 5px 8px)" label="Kesim çizgisi" />
            </Stack>
          </Box>

          <Box sx={{ minWidth: 0 }}>
            <Stack spacing={2}>
              <SelectionInfo selection={selection} pieces={pieces} kerf={settings.kerf} />
              <Divider />
              <Typography variant="subtitle2">Ürünler (bu kalıp)</Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Kod</TableCell>
                    <TableCell>Ürün</TableCell>
                    <TableCell align="right">1 tabakada</TableCell>
                    {sheet.copies > 1 && <TableCell align="right">Bu kalıpta (×{fmtInt(sheet.copies)})</TableCell>}
                    <TableCell align="right">Tüm plan / sipariş</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {[...pieces.values()].map((p) => (
                    <TableRow key={p.id}>
                      <TableCell sx={{ fontFamily: FONT_MONO }}>
                        <Box component="span" sx={{ display: 'inline-block', width: 12, height: 12, bgcolor: p.fill, border: `1px solid ${p.stroke}`, mr: 0.75, verticalAlign: -1 }} />
                        {p.code}
                      </TableCell>
                      <TableCell>{p.name}<Typography variant="caption" display="block" color="text.secondary">{fmtNum(p.width)}×{fmtNum(p.height)} mm</Typography></TableCell>
                      <TableCell align="right" sx={{ fontFamily: FONT_MONO }}>{sheetPieceCounts.get(p.id) ? fmtInt(sheetPieceCounts.get(p.id) ?? 0) : '—'}</TableCell>
                      {sheet.copies > 1 && <TableCell align="right" sx={{ fontFamily: FONT_MONO }}>{sheetPieceCounts.get(p.id) ? fmtInt((sheetPieceCounts.get(p.id) ?? 0) * sheet.copies) : '—'}</TableCell>}
                      <TableCell align="right" sx={{ fontFamily: FONT_MONO }}>{fmtInt(plan.placed[p.id] ?? 0)} / {fmtInt(p.quantity)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Stack>
          </Box>
        </Box>
      </Paper>
    </Stack>
  );
}

function LegendSwatch({ css, label }: { css: string; label: string }): ReactElement {
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Box sx={{ width: 16, height: 12, background: css, border: '1px solid #6b7280' }} />
      <Typography variant="caption">{label}</Typography>
    </Stack>
  );
}
