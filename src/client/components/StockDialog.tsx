import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Tooltip,
} from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { PAPER_PRESETS } from '../../shared/presets';
import type { CustomPaperDto, StockInput, StockItemDto } from '../../shared/api';
import { api } from '../api';
import { useToast } from '../hooks';
import { GRAIN_STOCK_LABEL } from '../labels';
import { NumberField } from './common';

interface Props {
  open: boolean;
  kind: 'sheet' | 'offcut';
  initial: StockItemDto | null;
  customPapers: CustomPaperDto[];
  onClose: () => void;
  onSaved: () => void;
}

interface FormatOption {
  label: string;
  group: string;
  width: number;
  height: number;
}

const EMPTY: StockInput = {
  kind: 'sheet',
  name: '',
  formatName: null,
  width: 700,
  height: 1000,
  quantity: 10,
  unitCost: null,
  gsm: null,
  color: null,
  finish: null,
  notes: null,
  allowRotation: true,
  grain: 'none',
  status: 'active',
};

export function StockDialog({ open, kind, initial, customPapers, onClose, onSaved }: Props): ReactElement {
  const toast = useToast();
  const [form, setForm] = useState<StockInput>({ ...EMPTY, kind });
  const [width, setWidth] = useState<number | null>(EMPTY.width);
  const [height, setHeight] = useState<number | null>(EMPTY.height);
  const [quantity, setQuantity] = useState<number | null>(EMPTY.quantity);
  const [cost, setCost] = useState<number | null>(null);
  const [gsm, setGsm] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const base: StockInput = initial ? { ...initial } : { ...EMPTY, kind };
    setForm(base);
    setWidth(base.width);
    setHeight(base.height);
    setQuantity(base.quantity);
    setCost(base.unitCost);
    setGsm(base.gsm);
    setError(null);
  }, [open, initial, kind]);

  const options = useMemo<FormatOption[]>(
    () => [
      ...customPapers.map((p) => ({ label: p.name, group: 'Özel formatlarım', width: p.width, height: p.height })),
      ...PAPER_PRESETS.map((p) => ({ label: p.name, group: p.group, width: p.width, height: p.height })),
    ],
    [customPapers],
  );

  const set = <K extends keyof StockInput>(key: K, value: StockInput[K]): void => setForm((f) => ({ ...f, [key]: value }));

  const save = async (): Promise<void> => {
    setError(null);
    if (!form.name.trim()) return setError('Kağıt adı boş bırakılamaz.');
    if (width === null || width <= 0 || height === null || height <= 0) return setError('Genişlik ve yükseklik sıfırdan büyük olmalıdır.');
    if (quantity === null || !Number.isInteger(quantity) || quantity < 0) return setError('Adet negatif olmayan bir tam sayı olmalıdır.');
    if (cost !== null && cost < 0) return setError('Birim maliyet negatif olamaz.');
    setBusy(true);
    const body: StockInput = { ...form, kind, width, height, quantity, unitCost: cost, gsm, allowRotation: true };
    try {
      if (initial) await api.stock.update(initial.id, body);
      else await api.stock.create(body);
      toast(initial ? 'Stok kaydı güncellendi.' : 'Stok kaydı eklendi.');
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kaydedilemedi.');
    } finally {
      setBusy(false);
    }
  };

  const title = kind === 'offcut' ? 'Artık parça' : 'Kağıt stoğu';

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" aria-labelledby="stock-dialog-title">
      <DialogTitle id="stock-dialog-title">{initial ? `${title} düzenle` : `${title} ekle`}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error" data-testid="stock-error">{error}</Alert>}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <TextField label="Kağıt adı / cinsi" required value={form.name} onChange={(e) => set('name', e.target.value)} helperText="Örn. Kuşe 135 gr. Aynı ad, gramaj, renk ve yüzeye sahip stoklar aynı malzeme sayılır." inputProps={{ 'data-testid': 'stock-name' }} />
            <Autocomplete<FormatOption, false, false, true>
              freeSolo
              options={options}
              groupBy={(o) => o.group}
              getOptionLabel={(o) => (typeof o === 'string' ? o : o.label)}
              inputValue={form.formatName ?? ''}
              onInputChange={(_, v) => set('formatName', v || null)}
              onChange={(_, v) => {
                if (v && typeof v !== 'string') {
                  setWidth(v.width);
                  setHeight(v.height);
                  set('formatName', v.label);
                }
              }}
              renderInput={(params) => <TextField {...params} label="Format (hazır veya özel)" helperText="Hazır bir format seçince ölçüler dolar; ölçüleri her zaman değiştirebilirsiniz." />}
            />
          </Box>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <NumberField label="Genişlik" unit="mm" value={width} onChange={setWidth} error={width !== null && width <= 0} fullWidth inputProps={{ 'data-testid': 'stock-width' }} />
            <Tooltip title="Genişlik ve yüksekliği değiştir">
              <IconButton aria-label="Ölçüleri çevir" onClick={() => { setWidth(height); setHeight(width); }} sx={{ mt: 0.25 }}><SwapHorizIcon /></IconButton>
            </Tooltip>
            <NumberField label="Yükseklik" unit="mm" value={height} onChange={setHeight} error={height !== null && height <= 0} fullWidth inputProps={{ 'data-testid': 'stock-height' }} />
          </Stack>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2 }}>
            <NumberField label="Adet" value={quantity} onChange={setQuantity} inputProps={{ 'data-testid': 'stock-quantity' }} />
            <NumberField label="Birim maliyet (isteğe bağlı)" unit="₺" value={cost} onChange={setCost} helperText="Boş = bilinmiyor" />
            <NumberField label="Gramaj (isteğe bağlı)" unit="gr" value={gsm} onChange={setGsm} />
            <TextField label="Renk" value={form.color ?? ''} onChange={(e) => set('color', e.target.value || null)} />
            <TextField label="Yüzey / kaplama" value={form.finish ?? ''} onChange={(e) => set('finish', e.target.value || null)} placeholder="Mat, parlak, …" />
            <TextField select label="Lif yönü" value={form.grain} onChange={(e) => set('grain', e.target.value as StockInput['grain'])} helperText="Lif kısıtlı ürünlerde dikkate alınır">
              {Object.entries(GRAIN_STOCK_LABEL).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
            </TextField>
          </Box>
          <TextField label="Not" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value || null)} multiline minRows={2} />
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
            <FormControlLabel control={<Switch checked={form.status === 'active'} onChange={(e) => set('status', e.target.checked ? 'active' : 'excluded')} />} label={kind === 'offcut' ? 'Kullanılabilir (kapalıysa hasarlı/ayrılmış sayılır)' : 'Optimizasyonda kullanılabilir'} />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Vazgeç</Button>
        <Button variant="contained" onClick={save} disabled={busy} data-testid="stock-save">Kaydet</Button>
      </DialogActions>
    </Dialog>
  );
}
