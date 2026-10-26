import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/EditOutlined';
import { useState, type ReactElement } from 'react';
import { PAPER_PRESETS } from '../../shared/presets';
import type { CustomPaperDto } from '../../shared/api';
import { api } from '../api';
import { fmtNum } from '../format';
import { useToast } from '../hooks';
import { NumberField } from './common';

interface Props {
  open: boolean;
  papers: CustomPaperDto[];
  onClose: () => void;
  onChanged: () => void;
}

/** Library of paper formats: built-in presets (read-only) and the user's own custom formats. */
export function PapersDialog({ open, papers, onClose, onChanged }: Props): ReactElement {
  const toast = useToast();
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [width, setWidth] = useState<number | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setEditing(null);
    setName('');
    setWidth(null);
    setHeight(null);
    setError(null);
  };

  const save = async (): Promise<void> => {
    if (!name.trim() || !width || !height || width <= 0 || height <= 0) return setError('Ad, genişlik ve yükseklik gereklidir; ölçüler sıfırdan büyük olmalıdır.');
    try {
      if (editing) await api.papers.update(editing, { name: name.trim(), width, height });
      else await api.papers.create({ name: name.trim(), width, height });
      toast('Format kaydedildi.');
      reset();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kaydedilemedi.');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Kağıt formatları</DialogTitle>
      <DialogContent dividers>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Özel formatlarım</Typography>
        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
        <Stack direction="row" spacing={1} sx={{ mb: 2 }} alignItems="flex-start">
          <TextField label="Format adı" value={name} onChange={(e) => setName(e.target.value)} sx={{ flex: 2 }} />
          <NumberField label="Genişlik" unit="mm" value={width} onChange={setWidth} sx={{ flex: 1 }} />
          <NumberField label="Yükseklik" unit="mm" value={height} onChange={setHeight} sx={{ flex: 1 }} />
          <Button variant="contained" onClick={save} sx={{ height: 40 }}>{editing ? 'Güncelle' : 'Ekle'}</Button>
        </Stack>
        <Table size="small" sx={{ mb: 3 }}>
          <TableBody>
            {papers.length === 0 && <TableRow><TableCell colSpan={3}><Typography variant="body2" color="text.secondary">Henüz özel format yok.</Typography></TableCell></TableRow>}
            {papers.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{p.name}</TableCell>
                <TableCell>{fmtNum(p.width)} × {fmtNum(p.height)} mm</TableCell>
                <TableCell align="right">
                  <IconButton size="small" aria-label="Düzenle" onClick={() => { setEditing(p.id); setName(p.name); setWidth(p.width); setHeight(p.height); }}><EditIcon fontSize="small" /></IconButton>
                  <IconButton size="small" aria-label="Sil" onClick={async () => { await api.papers.remove(p.id); onChanged(); }}><DeleteIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Hazır formatlar (milimetre)</Typography>
        <Table size="small">
          <TableHead>
            <TableRow><TableCell>Format</TableCell><TableCell>Grup</TableCell><TableCell align="right">Ölçü</TableCell></TableRow>
          </TableHead>
          <TableBody>
            {PAPER_PRESETS.map((p) => (
              <TableRow key={p.name}>
                <TableCell>{p.name}</TableCell>
                <TableCell>{p.group}</TableCell>
                <TableCell align="right">{fmtNum(p.width)} × {fmtNum(p.height)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Hazır formatlar yalnızca varsayılandır; her stok kaleminde ölçüleri serbestçe değiştirebilirsiniz.
        </Typography>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Kapat</Button></DialogActions>
    </Dialog>
  );
}
