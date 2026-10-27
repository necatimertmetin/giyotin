import { Alert, Box, Chip, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
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

export function PlanStats({ plan, input, meta }: Props): ReactElement {
  const t = plan.totals;
  const stockById = new Map(input.stocks.map((s) => [s.id, s]));
  return (
    <Stack spacing={2} data-testid="plan-stats">
      {plan.fulfilled ? (
        <Alert icon={<CheckCircleIcon />} severity="success" data-testid="fulfilled-banner">
          Sipariş eldeki stokla <b>tamamen karşılanabiliyor</b>.
        </Alert>
      ) : (
        <Alert icon={<WarningAmberIcon />} severity="warning" data-testid="fulfilled-banner">
          Sipariş <b>tamamen karşılanamıyor</b>. Karşılanamayan miktarlar aşağıda listelenmiştir.
        </Alert>
      )}
      {plan.overproduced && (
        <Alert severity="info" data-testid="overproduced-note">
          Tek kalıp için fazla üretim: {input.pieces.filter((p) => plan.overproduced?.[p.id]).map((p) => `${p.name} +${fmtInt(plan.overproduced?.[p.id] ?? 0)}`).join(', ')} adet.
        </Alert>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
        <Metric label="Kalıp sayısı" value={fmtInt(plan.sheets.length)} hint="farklı kesim düzeni" />
        <Metric label="Kullanılan tabaka" value={fmtInt(t.sheetCount)} hint={fmtArea(t.stockArea)} />
        <Metric label="Malzeme kullanımı" value={fmtPercent(t.utilization)} hint="bitmiş parça / sarf edilen stok" tone={t.utilization >= 0.85 ? 'good' : t.utilization < 0.7 ? 'warn' : undefined} />
        <Metric label="Bitmiş parça alanı" value={fmtArea(t.pieceArea)} />
        <Metric label="Kesim sayısı" value={fmtInt(t.cuts)} />
        <Metric label="Bıçak payı kaybı" value={fmtArea(t.kerfArea)} hint="kerf" />
        <Metric label="Kullanılamaz fire" value={fmtArea(t.wasteArea)} hint="kenar payı dahil" tone="bad" />
        <Metric label="Yeniden kullanılabilir artık" value={fmtArea(t.offcutArea)} tone="good" />
        <Metric label="Tahmini malzeme maliyeti" value={t.cost === null ? '—' : fmtMoney(t.cost)} hint={t.cost === null ? 'maliyet bilgisi girilmemiş' : undefined} />
      </Box>

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

      <Paper sx={{ overflow: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Stok</TableCell>
              <TableCell align="right">Kullanılan</TableCell>
              <TableCell align="right">Kalan envanter</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {input.stocks.map((s) => {
              const used = t.sheetsByStock[s.id] ?? 0;
              return (
                <TableRow key={s.id} selected={used > 0}>
                  <TableCell>
                    {s.name} · {fmtNum(s.width)}×{fmtNum(s.height)} mm {s.kind === 'offcut' && <Chip size="small" label="artık" sx={{ ml: 0.5 }} />}
                  </TableCell>
                  <TableCell align="right" sx={{ fontFamily: FONT_MONO }}>{fmtInt(used)}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: FONT_MONO }}>{fmtInt((stockById.get(s.id)?.quantity ?? 0) - used)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Paper>

      <Alert severity="info" icon={false} data-testid="heuristic-note">
        Bu plan, arama bütçesi içinde bulunan <b>en iyi plandır</b>; sezgisel (heuristik) bir yöntemle üretildiği için matematiksel olarak en iyi olduğu <b>kanıtlanmış değildir</b>.
        {meta && (
          <>
            {' '}Çalışma süresi {fmtDuration(meta.runtimeMs)}, {fmtInt(meta.nodesExplored)} durum incelendi
            {meta.stoppedBy === 'timeLimit' ? ' — süre sınırına ulaşıldı, sonuç eksik arama ile üretildi.' : '.'}
          </>
        )}
      </Alert>
    </Stack>
  );
}
