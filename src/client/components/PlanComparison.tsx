import { Box, Chip, Paper, Radio, Stack, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { useMemo, type ReactElement } from 'react';
import type { Plan } from '../../engine';
import { FONT_MONO } from '../theme';
import { fmtArea, fmtInt, fmtMoney, fmtPercent } from '../format';

interface Props {
  plans: Plan[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Lay the cards out in one horizontally scrolling row. */
  horizontal?: boolean;
}

type Criterion = 'sheets' | 'material' | 'cost' | 'waste' | 'offcut' | 'cuts';
type Best = Record<Criterion, Set<string>>;

/** "Plan 1", "Plan 2" … for ordinary plans (numbered without gaps); the single-stock plan is just "Tek Tabaka". */
export function planName(plans: Plan[], id: string): string {
  const plan = plans.find((p) => p.id === id);
  if (plan?.objective.profile === 'single-stock') return 'Tek Tabaka';
  return `Plan ${plans.filter((p) => p.objective.profile !== 'single-stock').findIndex((p) => p.id === id) + 1}`;
}

/** A plan is named after what it is actually best at in this comparison, never after how it was found. */
const BEST_LABELS: Array<[Criterion, string]> = [
  ['sheets', 'En az tabaka'],
  ['cost', 'En ucuz'],
  ['material', 'En az sarf'],
  ['waste', 'En az fire'],
  ['offcut', 'En çok artık'],
  ['cuts', 'En az kesim'],
];

function bestOf(plans: Plan[]): Best {
  const pool = plans.some((p) => p.fulfilled) ? plans.filter((p) => p.fulfilled) : plans;
  const pick = (value: (p: Plan) => number | null, dir: 'min' | 'max'): Set<string> => {
    const vals = pool.map((p) => ({ id: p.id, v: value(p) })).filter((x): x is { id: string; v: number } => x.v !== null);
    if (vals.length === 0) return new Set();
    const target = dir === 'min' ? Math.min(...vals.map((x) => x.v)) : Math.max(...vals.map((x) => x.v));
    return new Set(vals.filter((x) => Math.abs(x.v - target) < 1e-6).map((x) => x.id));
  };
  return {
    sheets: pick((p) => p.totals.sheetCount, 'min'),
    material: pick((p) => p.totals.stockArea, 'min'),
    cost: plans.every((p) => p.totals.cost !== null) ? pick((p) => p.totals.cost, 'min') : new Set(),
    waste: pick((p) => p.totals.wasteArea, 'min'),
    offcut: pick((p) => p.totals.offcutArea, 'max'),
    cuts: pick((p) => p.totals.cuts, 'min'),
  };
}

function Cell({ label, value, good }: { label: string; value: string; good?: boolean }): ReactElement {
  return (
    <Box sx={{ minWidth: 0, bgcolor: good ? 'rgba(21,128,61,0.1)' : undefined, borderRadius: 0.5, px: 0.5 }}>
      <Typography sx={{ fontSize: '0.6rem', letterSpacing: '0.03em', textTransform: 'uppercase', color: 'text.secondary', fontWeight: 700 }} noWrap>{label}</Typography>
      <Typography sx={{ fontFamily: FONT_MONO, fontSize: '0.72rem', lineHeight: 1.35, fontWeight: good ? 700 : 500 }} noWrap>
        {good && <CheckIcon sx={{ fontSize: 13, verticalAlign: -2, mr: 0.25, color: 'success.main' }} />}
        {value}
      </Typography>
    </Box>
  );
}

/** Compact list of alternative plans: pick one and its cutting view opens next to the list. */
export function PlanComparison({ plans, selectedId, onSelect, horizontal = false }: Props): ReactElement {
  const best = useMemo(() => bestOf(plans), [plans]);
  const multiple = plans.length > 1;

  return (
    <Box data-testid="plan-comparison">
      <Stack direction={horizontal ? 'row' : 'column'} spacing={1} sx={horizontal ? { overflowX: 'auto', pb: 1 } : undefined}>
      {plans.map((p, i) => {
        const selected = p.id === selectedId;
        const isBest = (c: Criterion): boolean => multiple && best[c].has(p.id);
        const tags: Array<[string, string]> = BEST_LABELS.filter(([c]) => isBest(c));
        if (p.objective.profile === 'single-stock') tags.unshift(['single-stock', 'Tek tabaka türü']);
        return (
          <Paper
            key={p.id}
            onClick={() => onSelect(p.id)}
            sx={{ p: 1, cursor: 'pointer', ...(horizontal ? { minWidth: 292, flexShrink: 0 } : {}), borderColor: selected ? 'primary.main' : 'divider', borderWidth: selected ? 2 : 1, bgcolor: selected ? '#fdf3ee' : 'background.paper', '&:hover': { borderColor: 'primary.light' } }}
            data-testid={`plan-row-${i + 1}`}
          >
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.25 }}>
              <Radio size="small" checked={selected} onChange={() => onSelect(p.id)} inputProps={{ 'aria-label': `${planName(plans, p.id)} seç` }} sx={{ p: 0.5 }} />
              <Typography sx={{ fontWeight: 700, fontSize: '0.9rem' }}>{planName(plans, p.id)}</Typography>
              {i === 0 && <Chip size="small" color="primary" label="Önerilen" sx={{ height: 20, fontSize: '0.68rem' }} />}
              {!p.fulfilled && <Chip size="small" color="warning" label="Eksik" sx={{ height: 20, fontSize: '0.68rem' }} />}
            </Stack>
            <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mb: 0.5, minHeight: 20 }}>
              {tags.map(([c, label]) => <Chip key={c} size="small" color="success" variant="outlined" label={label} sx={{ height: 20, fontSize: '0.66rem', '& .MuiChip-label': { px: 0.75 } }} />)}
              {tags.length === 0 && <Typography variant="caption" color="text.secondary">Alternatif</Typography>}
            </Stack>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 0.5 }}>
              <Cell label="Tabaka" value={fmtInt(p.totals.sheetCount)} good={isBest('sheets')} />
              <Cell label="Sarf" value={fmtArea(p.totals.stockArea)} good={isBest('material')} />
              <Cell label="Maliyet" value={p.totals.cost === null ? '—' : fmtMoney(p.totals.cost)} good={isBest('cost')} />
              <Cell label="Kullanım" value={fmtPercent(p.totals.utilization)} />
              <Cell label="Fire" value={fmtArea(p.totals.wasteArea)} good={isBest('waste')} />
              <Cell label="Artık" value={fmtArea(p.totals.offcutArea)} good={isBest('offcut')} />
              <Cell label="Kesim" value={fmtInt(p.totals.cuts)} good={isBest('cuts')} />
            </Box>
          </Paper>
        );
      })}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        <CheckIcon sx={{ fontSize: 13, verticalAlign: -2, color: 'success.main' }} /> işareti, o ölçütte en iyi değeri gösterir. Bir plana tıklayınca kesim görünümü sağda açılır.
      </Typography>
    </Box>
  );
}
