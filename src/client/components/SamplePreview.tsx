import { Alert, Box, Chip, Paper, Stack, Tab, Tabs, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { collectPieces, optimize, type CuttingSettings, type OptimizationInput, type Plan } from '../../engine';
import { materialLabelOf, type StockItemDto } from '../../shared/api';
import { fmtArea, fmtInt, fmtNum } from '../format';
import { CutStepper } from './CutStepper';
import { isValid, toDto, type DraftLine } from './OrderEditor';
import { SelectionInfo } from './SelectionInfo';
import { SheetViewer } from './SheetViewer';
import { buildPieceInfo, type Selection } from './viewerTypes';

interface Sample {
  input: OptimizationInput;
  plan: Plan;
  stockLabel: string;
}

/**
 * Cuts the order's products from ONE representative sheet with the current settings, using the real engine,
 * so the operator sees exactly how the settings change the cutting pattern.
 */
function buildSample(lines: DraftLine[], stock: StockItemDto[], settings: CuttingSettings, wantedMaterial: string | null): Sample | string {
  const valid = lines.filter(isValid).map(toDto);
  if (valid.length === 0) return 'Örnek tabaka için önce geçerli bir ürün satırı girin.';
  const sheets = stock.filter((s) => s.kind === 'sheet' && s.status === 'active' && s.quantity > 0);
  if (sheets.length === 0) return 'Örnek tabaka için envanterde kullanılabilir bir tabaka yok.';

  const pool = wantedMaterial ? sheets.filter((s) => s.materialKey === wantedMaterial) : sheets;
  if (pool.length === 0) return 'Bu kağıt cinsi için envanterde kullanılabilir tabaka yok.';
  const sheet = [...pool].sort((a, b) => b.width * b.height - a.width * a.height)[0]!;
  const lineList = valid.filter((l) => l.materialKey === null || l.materialKey === sheet.materialKey);
  if (lineList.length === 0) return 'Seçili kağıt cinsine uygun ürün yok.';

  const input: OptimizationInput = {
    settings: { ...settings, maxRuntimeMs: 1500, searchWidth: 4, costWeight: 0 },
    pieces: lineList.map((l, i) => ({
      id: `L${i + 1}`,
      name: l.name,
      width: l.width,
      height: l.height,
      quantity: l.quantity,
      allowRotation: l.allowRotation,
      materialKey: l.materialKey,
      grain: l.grain,
    })),
    stocks: [
      {
        id: 'sample',
        name: sheet.name,
        width: sheet.width,
        height: sheet.height,
        quantity: 1,
        unitCost: null,
        allowRotation: sheet.allowRotation,
        grain: sheet.grain,
        materialKey: sheet.materialKey,
        kind: 'sheet',
      },
    ],
  };
  const plan = optimize(input).plans[0];
  if (!plan || plan.sheets.length === 0) return 'Hiçbir ürün bu örnek tabakaya sığmıyor.';
  return { input, plan, stockLabel: `${sheet.name} · ${fmtNum(sheet.width)} × ${fmtNum(sheet.height)} mm (stoktaki en büyük uygun tabaka)` };
}

interface Props {
  lines: DraftLine[];
  stock: StockItemDto[];
  settings: CuttingSettings;
}

export function SamplePreview({ lines, stock, settings }: Props): ReactElement {
  const [sample, setSample] = useState<Sample | string | null>(null);
  const [tab, setTab] = useState<'overview' | 'steps'>('overview');
  const [step, setStep] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);

  // One sample sheet per paper type: different materials are never cut from the same sheet.
  const materials = useMemo(() => {
    const keys = [...new Set(lines.filter(isValid).map((l) => l.materialKey).filter((k): k is string => k !== null))];
    return keys.map((k) => {
      const s = stock.find((x) => x.materialKey === k);
      return { key: k, label: s ? materialLabelOf(s) : k };
    });
  }, [lines, stock]);
  const [material, setMaterial] = useState<string | null>(null);
  const activeMaterial = materials.some((m) => m.key === material) ? material : (materials[0]?.key ?? null);

  const key = JSON.stringify([lines.filter(isValid).map(toDto), settings, stock.map((s) => [s.id, s.version]), activeMaterial]);
  useEffect(() => {
    const t = setTimeout(() => {
      setSample(buildSample(lines, stock, settings, activeMaterial));
      setStep(0);
      setSelection(null);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const pieces = useMemo(() => (typeof sample === 'object' && sample ? buildPieceInfo(sample.input.pieces) : new Map()), [sample]);

  if (sample === null) return <Paper sx={{ p: 3 }}><Typography color="text.secondary">Örnek tabaka hazırlanıyor…</Typography></Paper>;
  if (typeof sample === 'string') return <Alert severity="info">{sample}</Alert>;

  const sheet = sample.plan.sheets[0]!;
  const counts = new Map<string, number>();
  for (const p of collectPieces(sheet.tree)) counts.set(p.pieceId, (counts.get(p.pieceId) ?? 0) + 1);

  return (
    <Paper sx={{ p: 2 }} data-testid="sample-preview">
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Typography sx={{ fontWeight: 700 }}>Örnek tabaka</Typography>
        <Typography variant="caption" color="text.secondary">{sample.stockLabel}</Typography>
      </Stack>
      {materials.length > 1 && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            Siparişinizde {materials.length} kağıt cinsi var; her cins ayrı tabakaya kesilir. Örneğini görmek için seçin:
          </Typography>
          <ToggleButtonGroup exclusive size="small" value={activeMaterial} onChange={(_, v: string | null) => v && setMaterial(v)} data-testid="sample-materials">
            {materials.map((m) => <ToggleButton key={m.key} value={m.key} sx={{ px: 2 }}>{m.label}</ToggleButton>)}
          </ToggleButtonGroup>
        </Box>
      )}
      <Tabs value={tab} onChange={(_, v: 'overview' | 'steps') => setTab(v)} sx={{ minHeight: 36, mb: 1.5, '& .MuiTab-root': { minHeight: 36, py: 0.5 } }}>
        <Tab value="overview" label="Genel görünüm" />
        <Tab value="steps" label="Nasıl kesilecek?" data-testid="sample-steps-tab" />
      </Tabs>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1fr) 300px' }, gap: 2 }}>
        <SheetViewer sheet={sheet} pieces={pieces} selection={selection} onSelect={setSelection} step={tab === 'steps' ? step : null} height={520} />
        <Box sx={{ minWidth: 0 }}>
          {tab === 'steps' ? (
            <CutStepper sheet={sheet} kerf={settings.kerf} step={step} onStep={setStep} />
          ) : (
            <Stack spacing={1.25}>
              <SelectionInfo selection={selection} pieces={pieces} kerf={settings.kerf} />
              <Typography variant="subtitle2" sx={{ pt: 1 }}>Bu tabakadan çıkanlar</Typography>
              {[...pieces.values()].filter((p) => counts.has(p.id)).map((p) => (
                <Stack key={p.id} direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2"><Box component="span" sx={{ display: 'inline-block', width: 12, height: 12, bgcolor: p.fill, border: `1px solid ${p.stroke}`, mr: 1 }} />{p.name} {fmtNum(p.width)}×{fmtNum(p.height)}</Typography>
                  <b>{fmtInt(counts.get(p.id) ?? 0)}</b>
                </Stack>
              ))}
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Chip size="small" label={`Kerf kaybı ${fmtArea(sheet.stats.kerfArea)}`} />
                <Chip size="small" color="success" variant="outlined" label={`Artık ${fmtArea(sheet.stats.offcutArea)}`} />
                <Chip size="small" color="error" variant="outlined" label={`Fire ${fmtArea(sheet.stats.wasteArea)}`} />
              </Stack>
            </Stack>
          )}
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
        Bu, siparişin bir tabakaya kesilmiş örneğidir ve ayarların etkisini gösterir; tüm sipariş için gerçek planı “Planı oluştur” hesaplar.
      </Typography>
    </Paper>
  );
}
