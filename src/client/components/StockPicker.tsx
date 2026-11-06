import { Button, Chip, Paper, Stack, Typography } from '@mui/material';
import { type ReactElement } from 'react';
import type { StockItemDto } from '../../shared/api';
import { fmtInt, fmtNum } from '../format';

interface Props {
  /** Inventory the job could use. */
  stock: StockItemDto[];
  /** Ids left out of this job. Everything else is tried, so paper added later is included by default. */
  skipped: Set<number>;
  onChange: (skipped: Set<number>) => void;
}

const label = (s: StockItemDto): string =>
  `${s.name}${s.formatName ? ` (${s.formatName})` : ''} · ${fmtNum(s.width)}×${fmtNum(s.height)} · ${fmtInt(s.quantity)} adet${s.kind === 'offcut' ? ' · artık' : ''}`;

/** Which inventory papers this job is calculated with. */
export function StockPicker({ stock, skipped, onChange }: Props): ReactElement | null {
  if (stock.length === 0) return null;
  const used = stock.filter((s) => !skipped.has(s.id)).length;
  const toggle = (id: number): void => {
    const next = new Set(skipped);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  return (
    <Paper sx={{ p: 2 }} data-testid="stock-picker">
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>Denenecek kağıtlar ({used} / {stock.length})</Typography>
        <Button size="small" disabled={used === stock.length} onClick={() => onChange(new Set())} data-testid="stock-all">Tümü</Button>
        <Button size="small" disabled={used === 0} onClick={() => onChange(new Set(stock.map((s) => s.id)))} data-testid="stock-none">Hiçbiri</Button>
      </Stack>
      <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1}>
        {stock.map((s) => {
          const on = !skipped.has(s.id);
          return <Chip key={s.id} label={label(s)} color={on ? 'primary' : 'default'} variant={on ? 'filled' : 'outlined'} aria-pressed={on} onClick={() => toggle(s.id)} data-testid={`stock-chip-${s.id}`} />;
        })}
      </Stack>
      {used === 0 && <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>Hesaplama için en az bir kağıt seçin.</Typography>}
    </Paper>
  );
}
