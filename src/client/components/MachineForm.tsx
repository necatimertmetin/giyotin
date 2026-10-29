import { Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, TextField, Typography } from '@mui/material';
import { useEffect, useState, type ReactElement } from 'react';
import type { MachineDto } from '../../shared/api';
import { useMachine, useToast } from '../hooks';
import { NumberField } from './common';

/** Common guillotine sizes (cut width, mm). */
const PRESETS = [560, 760, 920, 1150, 1370, 1550];

const validBlade = (v: number | null): v is number => v !== null && v >= 100 && v <= 5000;

function Fields({ value, onChange }: { value: { name: string; blade: number | null }; onChange: (v: { name: string; blade: number | null }) => void }): ReactElement {
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="flex-start" flexWrap="wrap" useFlexGap>
        <NumberField
          label="Bıçak boyu"
          value={value.blade}
          onChange={(blade) => onChange({ ...value, blade })}
          unit="mm"
          required
          error={value.blade !== null && !validBlade(value.blade)}
          helperText={value.blade !== null && !validBlade(value.blade) ? '100–5000 mm arası olmalı' : 'Tek hamlede kesilebilen en uzun kesim'}
          sx={{ width: 220 }}
          inputProps={{ 'data-testid': 'machine-blade' }}
        />
        <TextField label="Makine adı (isteğe bağlı)" placeholder="örn. Polar 115" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} sx={{ flex: 1, minWidth: 200 }} inputProps={{ 'data-testid': 'machine-name' }} />
      </Stack>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
        <Typography variant="caption" color="text.secondary">Yaygın boylar:</Typography>
        {PRESETS.map((p) => (
          <Chip key={p} label={`${p} mm`} size="small" clickable color={value.blade === p ? 'primary' : 'default'} variant={value.blade === p ? 'filled' : 'outlined'} onClick={() => onChange({ ...value, blade: p })} />
        ))}
      </Stack>
    </Stack>
  );
}

const toDto = (v: { name: string; blade: number | null }): MachineDto => ({ name: v.name.trim() || null, bladeLength: v.blade! });

/** Shown over the whole app until the guillotine has been entered; it cannot be dismissed. */
export function MachineSetupDialog(): ReactElement {
  const { machine, save } = useMachine();
  const toast = useToast();
  const [value, setValue] = useState<{ name: string; blade: number | null }>({ name: '', blade: null });
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await save(toDto(value));
      toast('Makine kaydedildi.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Kaydedilemedi.', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={machine === null} maxWidth="sm" fullWidth data-testid="machine-setup">
      <DialogTitle>Giyotininizi tanıtın</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" sx={{ mb: 2.5 }}>
          Planlar makinenizin bıçak boyuna göre hesaplanır; bıçaktan geniş bir kesim planlanmaz. Bunu bir kez girmeniz yeterli, sonra <b>Ayarlar</b>'dan değiştirebilirsiniz.
        </Typography>
        <Fields value={value} onChange={setValue} />
      </DialogContent>
      <DialogActions>
        <Button variant="contained" disabled={!validBlade(value.blade) || busy} onClick={() => void submit()} data-testid="machine-save">Kaydet ve başla</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Machine card of the settings page. */
export function MachineSettings(): ReactElement {
  const { machine, save } = useMachine();
  const toast = useToast();
  const [value, setValue] = useState<{ name: string; blade: number | null }>({ name: '', blade: null });
  useEffect(() => {
    if (machine) setValue({ name: machine.name ?? '', blade: machine.bladeLength });
  }, [machine]);
  const changed = !machine || (value.name.trim() || null) !== machine.name || value.blade !== machine.bladeLength;
  const submit = async (): Promise<void> => {
    try {
      await save(toDto(value));
      toast('Makine kaydedildi.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Kaydedilemedi.', 'error');
    }
  };
  return (
    <Paper sx={{ p: 2.5, maxWidth: 720 }}>
      <Typography variant="h6">Giyotin makinesi</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Tüm kesim işleri bu bıçak boyuyla planlanır. Değişiklik sonraki hesaplamalarda geçerli olur.</Typography>
      <Fields value={value} onChange={setValue} />
      <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
        <Button variant="contained" disabled={!validBlade(value.blade) || !changed} onClick={() => void submit()} data-testid="machine-settings-save">Kaydet</Button>
      </Stack>
    </Paper>
  );
}
