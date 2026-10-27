import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, List, ListItem, Stack, Typography } from '@mui/material';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { collectRemnants, type OptimizationInput, type Plan } from '../../engine';
import { FONT_MONO } from '../theme';
import { fmtArea, fmtInt, fmtNum } from '../format';

interface Props {
  open: boolean;
  plan: Plan;
  input: OptimizationInput;
  busy: boolean;
  onClose: () => void;
  onConfirm: (approvedOffcuts: string[]) => void;
}

/** Same keys as the server's `offcutLeaves`: `${sheetIndex}:${leafIndex}` over the offcut leaves of each sheet. */
export function planOffcuts(plan: Plan): Array<{ key: string; sheetIndex: number; width: number; height: number; quantity: number }> {
  const out: Array<{ key: string; sheetIndex: number; width: number; height: number; quantity: number }> = [];
  plan.sheets.forEach((sheet, sheetIndex) => {
    collectRemnants(sheet.tree)
      .filter((n) => n.type === 'offcut')
      .forEach((n, leafIndex) => out.push({ key: `${sheetIndex}:${leafIndex}`, sheetIndex, width: n.w, height: n.h, quantity: sheet.copies }));
  });
  return out;
}

export function ConfirmPlanDialog({ open, plan, input, busy, onClose, onConfirm }: Props): ReactElement {
  const offcuts = useMemo(() => planOffcuts(plan), [plan]);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setChecked(new Set(offcuts.map((o) => o.key)));
  }, [open, offcuts]);

  const stockById = new Map(input.stocks.map((s) => [s.id, s]));

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="confirm-title">
      <DialogTitle id="confirm-title">Planı onayla ve stoktan düş</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="warning" icon={false}>
            Onayladığınızda aşağıdaki miktarlar envanterden <b>kalıcı olarak düşülür</b>. Bu işlem tekrar uygulanamaz (çift düşüm engellenir).
          </Alert>
          <List dense disablePadding>
            {Object.entries(plan.totals.sheetsByStock).map(([id, n]) => {
              const s = stockById.get(id);
              return (
                <ListItem key={id} disableGutters sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="body2">{s?.name} · {fmtNum(s?.width ?? 0)}×{fmtNum(s?.height ?? 0)} mm {s?.kind === 'offcut' ? '(artık)' : ''}</Typography>
                  <Typography variant="body2" sx={{ fontFamily: FONT_MONO, fontWeight: 700 }}>−{fmtInt(n)} adet</Typography>
                </ListItem>
              );
            })}
          </List>
          {!plan.fulfilled && <Alert severity="error">Bu plan siparişi tamamen karşılamıyor; yalnızca planlanan kısım kesilecek.</Alert>}
          <div>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Oluşan artıklar — envantere eklenecekler</Typography>
            {offcuts.length === 0 && <Typography variant="body2" color="text.secondary">Bu planda yeniden kullanılabilir artık oluşmuyor.</Typography>}
            {offcuts.map((o) => (
              <FormControlLabel
                key={o.key}
                sx={{ display: 'flex' }}
                control={
                  <Checkbox
                    size="small"
                    checked={checked.has(o.key)}
                    onChange={(e) => {
                      const next = new Set(checked);
                      if (e.target.checked) next.add(o.key);
                      else next.delete(o.key);
                      setChecked(next);
                    }}
                  />
                }
                label={
                  <Typography variant="body2" sx={{ fontFamily: FONT_MONO }}>
                    Kalıp {o.sheetIndex + 1}: {fmtNum(o.width)}×{fmtNum(o.height)} mm × {fmtInt(o.quantity)} · {fmtArea(o.width * o.height)}
                  </Typography>
                }
              />
            ))}
            <Typography variant="caption" color="text.secondary">Seçmediğiniz artıkları daha sonra geçmiş sayfasından da ekleyebilirsiniz.</Typography>
          </div>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Vazgeç</Button>
        <Button variant="contained" disabled={busy || plan.sheets.length === 0} onClick={() => onConfirm([...checked])} data-testid="confirm-plan">
          Onayla ve stoktan düş
        </Button>
      </DialogActions>
    </Dialog>
  );
}
