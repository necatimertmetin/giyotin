import { Box, Chip, Divider, Paper, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, Typography } from '@mui/material';
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { collectPieces, collectRemnants, type CuttingSettings, type OptimizationInput, type OptimizationResult, type Plan } from '../../engine';
import { FONT_MONO } from '../theme';
import { fmtArea, fmtInt, fmtNum, fmtPercent } from '../format';
import { CutStepper } from './CutStepper';
import { CutTree } from './CutTree';
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

type PanelTab = 'info' | 'steps' | 'tree' | 'offcuts';

/** Cutting plan detail: interactive sheet viewer, step-by-step mode, cut tree, offcuts and totals. */
export function PlanView({ plan, input, settings, meta, actions, stacked = false }: Props): ReactElement {
  const pieces = useMemo(() => buildPieceInfo(input.pieces), [input.pieces]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [tab, setTab] = useState<PanelTab>('info');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    setSheetIndex(0);
    setSelection(null);
    setStep(0);
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

  const offcuts = collectRemnants(sheet.tree).filter((n) => n.type === 'offcut');
  const stepMode = tab === 'steps';

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
            setStep(0);
          }}
          variant="scrollable"
          scrollButtons="auto"
          aria-label="Tabakalar"
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          {plan.sheets.map((s, i) => (
            <Tab key={i} value={i} label={sheetLabel(s, i)} data-testid={`sheet-tab-${i}`} />
          ))}
        </Tabs>

        <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: stacked ? '1fr' : { xs: '1fr', lg: 'minmax(0, 1fr) 360px' }, gap: 2 }}>
          <Box sx={{ minWidth: 0 }}>
            <SheetViewer sheet={sheet} pieces={pieces} selection={selection} onSelect={setSelection} step={stepMode ? step : null} />
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }} alignItems="center">
              <Chip size="small" label={`Kullanım ${fmtPercent(sheet.stats.pieceArea / sheet.stats.sheetArea)}`} color="primary" />
              <Chip size="small" variant="outlined" label={`${fmtInt(sheet.stats.pieceCount)} parça`} />
              <Chip size="small" variant="outlined" label={`${fmtInt(sheet.stats.cuts)} kesim`} />
              <Chip size="small" variant="outlined" label={`Fire ${fmtArea(sheet.stats.wasteArea)}`} />
              <Chip size="small" variant="outlined" label={`Artık ${fmtArea(sheet.stats.offcutArea)}`} />
              {sheet.copies > 1 && <Chip size="small" color="secondary" label={`Bu desen ${sheet.copies} tabakada tekrarlanır`} />}
              <Box sx={{ flex: 1 }} />
              <LegendSwatch css="repeating-linear-gradient(45deg,#d7f0e4 0 4px,#2f855a 4px 5px)" label="Artık" />
              <LegendSwatch css="repeating-linear-gradient(45deg,#f3d9d6 0 4px,#b4463c 4px 5px)" label="Fire" />
              <LegendSwatch css="#1f2933" label="Kerf" />
              <LegendSwatch css="repeating-linear-gradient(90deg,#c2410c 0 5px,transparent 5px 8px)" label="Kesim çizgisi" />
            </Stack>
          </Box>

          <Box sx={{ minWidth: 0 }}>
            <Tabs value={tab} onChange={(_, v: PanelTab) => setTab(v)} variant="fullWidth" sx={{ minHeight: 36, borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minHeight: 36, py: 0.5 } }}>
              <Tab value="info" label="Ayrıntı" data-testid="tab-info" />
              <Tab value="steps" label="Adımlar" data-testid="tab-steps" />
              <Tab value="tree" label="Ağaç" data-testid="tab-tree" />
              <Tab value="offcuts" label="Artık" data-testid="tab-offcuts" />
            </Tabs>
            <Box sx={{ pt: 2 }}>
              {tab === 'info' && (
                <Stack spacing={2}>
                  <SelectionInfo selection={selection} pieces={pieces} kerf={settings.kerf} />
                  <Divider />
                  <Typography variant="subtitle2">Ürünler (bu tabaka)</Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Kod</TableCell>
                        <TableCell>Ürün</TableCell>
                        <TableCell align="right">Bu tabaka</TableCell>
                        <TableCell align="right">Toplam</TableCell>
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
                          <TableCell align="right" sx={{ fontFamily: FONT_MONO }}>{fmtInt(sheetPieceCounts.get(p.id) ?? 0)}</TableCell>
                          <TableCell align="right" sx={{ fontFamily: FONT_MONO }}>{fmtInt(plan.placed[p.id] ?? 0)} / {fmtInt(p.quantity)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Stack>
              )}
              {tab === 'steps' && <CutStepper sheet={sheet} kerf={settings.kerf} step={step} onStep={setStep} />}
              {tab === 'tree' && <CutTree tree={sheet.tree} pieces={pieces} />}
              {tab === 'offcuts' && (
                <Stack spacing={1}>
                  {offcuts.length === 0 && <Typography variant="body2" color="text.secondary">Bu tabakada yeniden kullanılabilir artık oluşmuyor.</Typography>}
                  {offcuts.map((o, i) => (
                    <Paper key={i} sx={{ p: 1, cursor: 'pointer' }} onClick={() => setSelection({ kind: 'remnant', node: o })}>
                      <Typography sx={{ fontFamily: FONT_MONO, fontWeight: 700 }}>{fmtNum(o.w)} × {fmtNum(o.h)} mm</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {fmtArea(o.w * o.h)} · konum {fmtNum(o.x)}, {fmtNum(o.y)}{sheet.copies > 1 ? ` · ×${sheet.copies} tabaka` : ''}
                      </Typography>
                    </Paper>
                  ))}
                  <Typography variant="caption" color="text.secondary">
                    Artıklar yalnızca kesim ağacının gerçek dikdörtgen yapraklarıdır (min. {fmtNum(settings.minOffcutWidth)}×{fmtNum(settings.minOffcutHeight)} mm).
                  </Typography>
                </Stack>
              )}
            </Box>
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
