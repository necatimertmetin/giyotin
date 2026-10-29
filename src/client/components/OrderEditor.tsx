import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { Fragment, useRef, useState, type DragEvent, type ReactElement } from 'react';
import { allowedOrientations, edgeMarginsOf, toUnits, type CuttingSettings, type EdgeMargins } from '../../engine';
import type { OrderLineDto, StockItemDto } from '../../shared/api';
import { api } from '../api';
import { rememberArtwork, useArtworks, useToast } from '../hooks';
import { saveArtworkSource } from '../import/artworkSources';
import { ACCEPTED_EXTENSIONS, readArtworkFile } from '../import/importArtwork';
import { GRAIN_PIECE_LABEL } from '../labels';
import { NumberField } from './common';

export interface DraftLine {
  key: string;
  name: string;
  width: number | null;
  height: number | null;
  quantity: number | null;
  notes: string;
  allowRotation: boolean;
  materialKey: string | null;
  grain: OrderLineDto['grain'];
  minWidth: number | null;
  minHeight: number | null;
  artworkId: string | null;
}

let counter = 0;
export const newLine = (over: Partial<DraftLine> = {}): DraftLine => ({
  key: `line-${Date.now()}-${counter++}`,
  name: '',
  width: null,
  height: null,
  quantity: null,
  notes: '',
  allowRotation: true,
  materialKey: null,
  grain: 'any',
  minWidth: null,
  minHeight: null,
  artworkId: null,
  ...over,
});

export const fromDto = (l: OrderLineDto): DraftLine =>
  newLine({
    name: l.name,
    width: l.width,
    height: l.height,
    quantity: l.quantity,
    notes: l.notes ?? '',
    allowRotation: true,
    materialKey: l.materialKey,
    grain: l.grain,
    minWidth: l.minWidth,
    minHeight: l.minHeight,
    artworkId: l.artworkId ?? null,
  });

export function lineErrors(l: DraftLine): { name?: string; width?: string; height?: string; quantity?: string } {
  const e: { name?: string; width?: string; height?: string; quantity?: string } = {};
  if (!l.name.trim()) e.name = 'Ürün adı gerekli';
  if (l.width === null || l.width <= 0) e.width = 'Sıfırdan büyük olmalı';
  if (l.height === null || l.height <= 0) e.height = 'Sıfırdan büyük olmalı';
  if (l.quantity === null || !Number.isInteger(l.quantity) || l.quantity < 1) e.quantity = 'Tam sayı ≥ 1';
  return e;
}

export const isValid = (l: DraftLine): boolean => Object.keys(lineErrors(l)).length === 0;

export function toDto(l: DraftLine): OrderLineDto {
  return {
    name: l.name.trim(),
    width: l.width ?? 0,
    height: l.height ?? 0,
    quantity: l.quantity ?? 0,
    notes: l.notes.trim() || null,
    allowRotation: true,
    materialKey: l.materialKey,
    grain: l.grain,
    minWidth: l.minWidth,
    minHeight: l.minHeight,
    artworkId: l.artworkId,
  };
}

/** A row nobody has typed into yet. */
const isBlank = (l: DraftLine): boolean => !l.name.trim() && l.width === null && l.height === null && l.quantity === null;

interface Props {
  lines: DraftLine[];
  onChange: (lines: DraftLine[]) => void;
  stock: StockItemDto[];
  materials: Array<{ key: string; label: string }>;
  settings: CuttingSettings;
}

/** True when the piece cannot be cut from any eligible stock item. */
function fitsNowhere(l: DraftLine, stock: StockItemDto[], margin: EdgeMargins): boolean {
  if (!isValid(l)) return false;
  const usable = stock.filter((s) => s.status === 'active' && s.quantity > 0 && (l.materialKey === null || s.materialKey === l.materialKey));
  if (usable.length === 0) return true;
  return !usable.some((s) =>
    allowedOrientations({ w: toUnits(l.width!), h: toUnits(l.height!), allowRotation: l.allowRotation, grain: l.grain }, s).some(
      (o) => o.w <= toUnits(s.width - margin.left - margin.right) && o.h <= toUnits(s.height - margin.top - margin.bottom),
    ),
  );
}

export function OrderEditor({ lines, onChange, stock, materials, settings }: Props): ReactElement {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const update = (key: string, patch: Partial<DraftLine>): void => onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const images = useArtworks(lines.map((l) => l.artworkId));
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  // Reading files takes a while; rows edited meanwhile must not be overwritten with a stale list.
  const latest = useRef(lines);
  latest.current = lines;

  const importFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0 || importing) return;
    setImporting(true);
    const added: DraftLine[] = [];
    const problems: string[] = [];
    const notes: string[] = [];
    for (const file of files) {
      try {
        for (const a of await readArtworkFile(file)) {
          let artworkId: string | null = null;
          if (a.thumbnail) {
            const saved = await api.artworks.create(a.thumbnail);
            rememberArtwork(saved.id, saved.data);
            artworkId = saved.id;
            // The vector original stays in this browser for printing; without it the PDF uses the preview image.
            if (a.source) await saveArtworkSource(saved.id, a.source).catch(() => undefined);
          }
          added.push(newLine({ name: a.name, width: a.width, height: a.height, quantity: 1, artworkId }));
          if (a.note) notes.push(`${a.name}: ${a.note}`);
        }
      } catch (e) {
        problems.push(e instanceof Error ? e.message : `${file.name}: okunamadı.`);
      }
    }
    setImporting(false);
    if (added.length > 0) onChange([...latest.current.filter((l) => !isBlank(l)), ...added]);
    if (problems.length > 0) toast([...(added.length > 0 ? [`${added.length} ürün eklendi.`] : []), ...problems].join(' '), 'error');
    else if (notes.length > 0) toast(`${added.length} ürün eklendi. ${notes.join(' ')}`, 'warning');
    else if (added.length > 0) toast(`${added.length} ürün eklendi. Adetleri girmeyi unutmayın.`);
  };

  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    setDragging(false);
    void importFiles([...e.dataTransfer.files]);
  };
  const onDragOver = (e: DragEvent): void => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dragging) setDragging(true);
  };

  return (
    <Paper
      sx={{ overflow: 'hidden', position: 'relative', outline: dragging ? '2px dashed' : 'none', outlineColor: 'primary.main', outlineOffset: -2 }}
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={onDrop}
      data-testid="order-drop"
    >
      <TableContainer>
        <Table size="small" data-testid="order-lines">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 40 }} />
              <TableCell sx={{ minWidth: 160 }}>Ürün</TableCell>
              <TableCell sx={{ width: 120 }}>Genişlik</TableCell>
              <TableCell sx={{ width: 120 }}>Yükseklik</TableCell>
              <TableCell sx={{ width: 110 }}>Adet</TableCell>
              <TableCell sx={{ minWidth: 190 }}>Kağıt cinsi</TableCell>
              <TableCell align="right" sx={{ width: 100 }}>İşlem</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {lines.map((l, idx) => {
              const err = lineErrors(l);
              const showErr = l.name !== '' || l.width !== null || l.height !== null || l.quantity !== null;
              const nofit = fitsNowhere(l, stock, edgeMarginsOf(settings));
              const expanded = open.has(l.key);
              return (
                <Fragment key={l.key}>
                  <TableRow data-testid={`line-${idx}`}>
                    <TableCell padding="checkbox">
                      <IconButton size="small" aria-label="Ayrıntılar" onClick={() => { const n = new Set(open); if (expanded) n.delete(l.key); else n.add(l.key); setOpen(n); }} sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
                        <ExpandMoreIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                      {l.artworkId && images.get(l.artworkId) && (
                        <Box component="img" src={images.get(l.artworkId)} alt="" data-testid={`line-artwork-${idx}`} sx={{ width: 44, height: 44, objectFit: 'contain', flexShrink: 0, border: 1, borderColor: 'divider', borderRadius: 0.5, bgcolor: '#fff' }} />
                      )}
                      <TextField fullWidth placeholder="Örn. Flyer" value={l.name} onChange={(e) => update(l.key, { name: e.target.value })} error={showErr && !!err.name} inputProps={{ 'aria-label': 'Ürün adı', 'data-testid': `line-name-${idx}` }} />
                      </Stack>
                      {nofit && <Chip size="small" color="error" label="Hiçbir stoğa sığmıyor" sx={{ mt: 0.5 }} data-testid={`line-nofit-${idx}`} />}
                    </TableCell>
                    <TableCell><NumberField fullWidth unit="mm" value={l.width} onChange={(v) => update(l.key, { width: v })} error={showErr && !!err.width} helperText={showErr ? err.width : undefined} inputProps={{ 'aria-label': 'Genişlik', 'data-testid': `line-width-${idx}` }} /></TableCell>
                    <TableCell><NumberField fullWidth unit="mm" value={l.height} onChange={(v) => update(l.key, { height: v })} error={showErr && !!err.height} helperText={showErr ? err.height : undefined} inputProps={{ 'aria-label': 'Yükseklik', 'data-testid': `line-height-${idx}` }} /></TableCell>
                    <TableCell><NumberField fullWidth value={l.quantity} onChange={(v) => update(l.key, { quantity: v })} error={showErr && !!err.quantity} helperText={showErr ? err.quantity : undefined} inputProps={{ 'aria-label': 'Adet', 'data-testid': `line-qty-${idx}` }} /></TableCell>
                    <TableCell>
                      <TextField select fullWidth value={l.materialKey ?? ''} onChange={(e) => update(l.key, { materialKey: e.target.value || null })} inputProps={{ 'aria-label': 'Kağıt cinsi' }} SelectProps={{ displayEmpty: true, renderValue: (v) => (v === '' ? 'Fark etmez' : (materials.find((m) => m.key === v)?.label ?? String(v))) }}>
                        <MenuItem value="">Fark etmez</MenuItem>
                        {materials.map((m) => <MenuItem key={m.key} value={m.key}>{m.label}</MenuItem>)}
                      </TextField>
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Tooltip title="Çoğalt"><IconButton size="small" aria-label="Satırı çoğalt" onClick={() => { const copy = newLine({ ...l, name: l.name ? `${l.name} (kopya)` : '' }); const next = [...lines]; next.splice(idx + 1, 0, copy); onChange(next); }}><ContentCopyIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="Sil"><span><IconButton size="small" aria-label="Satırı sil" disabled={lines.length === 1} onClick={() => onChange(lines.filter((x) => x.key !== l.key))}><DeleteIcon fontSize="small" /></IconButton></span></Tooltip>
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={7} sx={{ py: 0, borderBottom: expanded ? undefined : 0 }}>
                      <Collapse in={expanded} unmountOnExit>
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr 1fr 1fr' }, gap: 2, py: 1.5 }}>
                          <TextField label="Not" value={l.notes} onChange={(e) => update(l.key, { notes: e.target.value })} />
                          <TextField select label="Gerekli lif yönü" value={l.grain} onChange={(e) => update(l.key, { grain: e.target.value as DraftLine['grain'] })}>
                            {Object.entries(GRAIN_PIECE_LABEL).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
                          </TextField>
                          <NumberField label="Min. kabul edilebilir genişlik" unit="mm" value={l.minWidth} onChange={(v) => update(l.key, { minWidth: v })} />
                          <NumberField label="Min. kabul edilebilir yükseklik" unit="mm" value={l.minHeight} onChange={(v) => update(l.key, { minHeight: v })} />
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ pb: 1, display: 'block' }}>
                          Minimum ölçüler şimdilik yalnızca kayıt amaçlıdır (gelecekteki üretim kısıtları için); optimizasyon tam ölçüyü üretir.
                        </Typography>
                      </Collapse>
                    </TableCell>
                  </TableRow>
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2, py: 1, borderTop: 1, borderColor: 'divider', bgcolor: dragging ? 'action.hover' : undefined }}>
        <Button size="small" startIcon={importing ? <CircularProgress size={16} /> : <UploadFileIcon />} disabled={importing} onClick={() => fileInput.current?.click()} data-testid="import-artwork">
          Çizimden ekle
        </Button>
        <Typography variant="caption" color="text.secondary">
          {importing ? 'Dosyalar okunuyor…' : 'AI, PDF, SVG veya EPS dosyalarını buraya sürükleyin: ölçü ve önizleme dosyadan alınır. Corel için önce PDF çıkarın.'}
        </Typography>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept={ACCEPTED_EXTENSIONS}
          data-testid="import-artwork-input"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void importFiles(files);
          }}
        />
      </Stack>
    </Paper>
  );
}
