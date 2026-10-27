import { Alert, Box, Paper, Stack, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { ReactElement, ReactNode } from 'react';
import type { OptimizationInput, OptimizationResult, Plan } from '../../engine';
import { FONT_MONO } from '../theme';
import { fmtArea, fmtDuration, fmtInt, fmtMoney, fmtNum, fmtPercent } from '../format';

export function Metric({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'good' | 'bad' | 'warn' }): ReactElement {
  const color = tone === 'good' ? 'success.main' : tone === 'bad' ? 'error.main' : tone === 'warn' ? 'warning.main' : 'text.primary';
  return (
    <Paper sx={{ p: 1.5, minWidth: 0 }}>
      <Typography variant="subtitle2">{label}</Typography>
      <Typography sx={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: '1.25rem', color, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{value}</Typography>
      {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
    </Paper>
  );
}

interface Props {
  plan: Plan;
  input: OptimizationInput;
  meta?: Pick<OptimizationResult, 'runtimeMs' | 'stoppedBy' | 'nodesExplored'>;
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'good' | 'bad' | 'warn' }): ReactElement {
  const color = tone === 'good' ? 'success.main' : tone === 'bad' ? 'error.main' : tone === 'warn' ? 'warning.main' : 'text.primary';
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: '0.66rem', letterSpacing: '0.03em', textTransform: 'uppercase', color: 'text.secondary', fontWeight: 700 }} noWrap>{label}</Typography>
      <Typography sx={{ fontFamily: FONT_MONO, fontWeight: 700, fontSize: '0.95rem', color, lineHeight: 1.3 }} noWrap>{value}</Typography>
    </Box>
  );
}

export function PlanStats({ plan, input, meta }: Props): ReactElement {
  const t = plan.totals;
  const stockById = new Map(input.stocks.map((s) => [s.id, s]));
  const used = input.stocks.filter((s) => (t.sheetsByStock[s.id] ?? 0) > 0);
  const extra = input.pieces.filter((p) => plan.overproduced?.[p.id]).map((p) => `${p.name} +${fmtInt(plan.overproduced?.[p.id] ?? 0)}`);
  return (
    <Stack spacing={1} data-testid="plan-stats">
      {plan.fulfilled ? (
        <Alert icon={<CheckCircleIcon />} severity="success" sx={{ py: 0 }} data-testid="fulfilled-banner">
          Sipariş eldeki stokla <b>tamamen karşılanabiliyor</b>.{extra.length > 0 && <> Fazla üretim: {extra.join(', ')} adet.</>}
        </Alert>
      ) : (
        <Alert icon={<WarningAmberIcon />} severity="warning" sx={{ py: 0 }} data-testid="fulfilled-banner">
          Sipariş <b>tamamen karşılanamıyor</b>. Karşılanamayan miktarlar aşağıda listelenmiştir.
        </Alert>
      )}
      <Paper sx={{ p: 1.5 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' }, gap: 1.25 }}>
          <Stat label="Kalıp" value={fmtInt(plan.sheets.length)} />
          <Stat label="Tabaka" value={`${fmtInt(t.sheetCount)} · ${fmtArea(t.stockArea)}`} />
          <Stat label="Kullanım" value={fmtPercent(t.utilization)} tone={t.utilization >= 0.85 ? 'good' : t.utilization < 0.7 ? 'warn' : undefined} />
          <Stat label="Maliyet" value={t.cost === null ? '—' : fmtMoney(t.cost)} />
          <Stat label="Kesim" value={fmtInt(t.cuts)} />
          <Stat label="Fire" value={fmtArea(t.wasteArea)} tone="bad" />
          <Stat label="Artık" value={fmtArea(t.offcutArea)} tone="good" />
          <Stat label="Bıçak payı" value={fmtArea(t.kerfArea)} />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {used.map((s) => `${s.name} · ${fmtNum(s.width)}×${fmtNum(s.height)} mm${s.kind === 'offcut' ? ' (artık)' : ''}: ${fmtInt(t.sheetsByStock[s.id] ?? 0)} kullanıldı, ${fmtInt((stockById.get(s.id)?.quantity ?? 0) - (t.sheetsByStock[s.id] ?? 0))} kaldı`).join(' · ')}
        </Typography>
      </Paper>

      {plan.unfulfilled.length > 0 && (
        <Paper sx={{ p: 1.5, borderColor: 'warning.main' }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Karşılanamayan ürünler</Typography>
          {plan.unfulfilled.map((u) => (
            <Typography key={u.pieceId} variant="body2" data-testid="unfulfilled-row">
              {u.name}: <b>{fmtInt(u.quantity)}</b> adet eksik
            </Typography>
          ))}
        </Paper>
      )}

      <Typography variant="caption" color="text.secondary" data-testid="heuristic-note">
        Sezgisel yöntemle bulundu; en iyi olduğu kanıtlanmış değildir.
        {meta && ` ${fmtDuration(meta.runtimeMs)}, ${fmtInt(meta.nodesExplored)} durum${meta.stoppedBy === 'timeLimit' ? ' — süre sınırına ulaşıldı, arama eksik kaldı.' : '.'}`}
      </Typography>
    </Stack>
  );
}
