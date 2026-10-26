import { Box, Chip, IconButton, InputAdornment, MenuItem, Paper, Stack, Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, TextField, Tooltip, Typography, FormControlLabel } from '@mui/material';
import DeleteIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/EditOutlined';
import SearchIcon from '@mui/icons-material/Search';
import { useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { materialLabelOf, type StockItemDto } from '../../shared/api';
import { FONT_MONO } from '../theme';
import { fmtArea, fmtInt, fmtMoney, fmtNum } from '../format';
import { GRAIN_STOCK_LABEL } from '../labels';
import { EmptyState } from './common';

type SortKey = 'name' | 'size' | 'area' | 'quantity' | 'cost' | 'gsm' | 'created';

interface Props {
  items: StockItemDto[];
  kind: 'sheet' | 'offcut';
  onEdit: (item: StockItemDto) => void;
  onDelete: (item: StockItemDto) => void;
  onToggleStatus?: (item: StockItemDto, active: boolean) => void;
}

const sortValue = (s: StockItemDto, key: SortKey): number | string => {
  switch (key) {
    case 'name':
      return `${materialLabelOf(s)}`.toLocaleLowerCase('tr-TR');
    case 'size':
      return s.width * 100000 + s.height;
    case 'area':
      return s.width * s.height;
    case 'quantity':
      return s.quantity;
    case 'cost':
      return s.unitCost ?? -1;
    case 'gsm':
      return s.gsm ?? 0;
    case 'created':
      return s.createdAt;
  }
};

export function StockTable({ items, kind, onEdit, onDelete, onToggleStatus }: Props): ReactElement {
  const [search, setSearch] = useState('');
  const [material, setMaterial] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'excluded'>('all');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>(kind === 'offcut' ? 'created' : 'name');
  const [dir, setDir] = useState<'asc' | 'desc'>(kind === 'offcut' ? 'desc' : 'asc');

  const materials = useMemo(() => {
    const m = new Map<string, string>();
    items.forEach((i) => m.set(i.materialKey, materialLabelOf(i)));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'tr'));
  }, [items]);

  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    const list = items.filter((i) => {
      if (material && i.materialKey !== material) return false;
      if (status !== 'all' && i.status !== status) return false;
      if (hideEmpty && i.quantity === 0) return false;
      if (!q) return true;
      return [i.name, i.formatName, i.color, i.finish, i.notes, `${i.width}x${i.height}`, `${i.width}×${i.height}`]
        .filter(Boolean)
        .some((t) => String(t).toLocaleLowerCase('tr-TR').includes(q));
    });
    const sign = dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      return (typeof va === 'string' ? va.localeCompare(String(vb), 'tr') : va - Number(vb)) * sign;
    });
  }, [items, search, material, status, hideEmpty, sortKey, dir]);

  const head = (key: SortKey, label: string, align: 'left' | 'right' = 'left'): ReactElement => (
    <TableCell align={align} sortDirection={sortKey === key ? dir : false}>
      <TableSortLabel
        active={sortKey === key}
        direction={sortKey === key ? dir : 'asc'}
        onClick={() => {
          if (sortKey === key) setDir(dir === 'asc' ? 'desc' : 'asc');
          else {
            setSortKey(key);
            setDir('asc');
          }
        }}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  );

  const totalArea = rows.reduce((a, r) => a + r.width * r.height * r.quantity, 0);

  return (
    <Paper>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 2 }} alignItems={{ md: 'center' }}>
        <TextField
          placeholder="Ara: ad, format, renk, ölçü…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          sx={{ minWidth: 260, flex: 1 }}
          inputProps={{ 'data-testid': 'stock-search' }}
        />
        <TextField select label="Kağıt cinsi" value={material} onChange={(e) => setMaterial(e.target.value)} sx={{ minWidth: 220 }}>
          <MenuItem value="">Tümü</MenuItem>
          {materials.map(([k, l]) => <MenuItem key={k} value={k}>{l}</MenuItem>)}
        </TextField>
        <TextField select label="Durum" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} sx={{ minWidth: 150 }}>
          <MenuItem value="all">Tümü</MenuItem>
          <MenuItem value="active">Kullanılabilir</MenuItem>
          <MenuItem value="excluded">{kind === 'offcut' ? 'Hariç tutulan' : 'Kapalı'}</MenuItem>
        </TextField>
        <FormControlLabel control={<Switch size="small" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />} label={<Typography variant="body2">Tükenenleri gizle</Typography>} />
      </Stack>
      <TableContainer>
        <Table size="small" data-testid="stock-table">
          <TableHead>
            <TableRow>
              {head('name', 'Kağıt')}
              {head('size', 'Ölçü (G × Y)')}
              {head('quantity', 'Adet', 'right')}
              {head('cost', 'Birim maliyet', 'right')}
              {head('gsm', 'Gramaj', 'right')}
              <TableCell>Özellikler</TableCell>
              {kind === 'offcut' && head('created', 'Oluşturma')}
              <TableCell>{kind === 'offcut' ? 'Kullanılabilir' : 'Durum'}</TableCell>
              <TableCell align="right">İşlem</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.id} hover sx={{ opacity: s.status === 'excluded' ? 0.6 : 1 }} data-testid="stock-row">
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 650 }}>{s.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{[s.formatName, s.color, s.finish].filter(Boolean).join(' · ') || '—'}</Typography>
                </TableCell>
                <TableCell sx={{ fontFamily: FONT_MONO, whiteSpace: 'nowrap' }}>
                  {fmtNum(s.width)} × {fmtNum(s.height)}
                  <Typography variant="caption" color="text.secondary" display="block">{fmtArea(s.width * s.height)} / adet</Typography>
                </TableCell>
                <TableCell align="right" sx={{ fontFamily: FONT_MONO }}>
                  {s.quantity === 0 ? <Chip size="small" label="Tükendi" /> : fmtInt(s.quantity)}
                </TableCell>
                <TableCell align="right" sx={{ fontFamily: FONT_MONO }}>{s.unitCost === null ? '—' : fmtMoney(s.unitCost)}</TableCell>
                <TableCell align="right" sx={{ fontFamily: FONT_MONO }}>{s.gsm ? `${fmtNum(s.gsm, 0)} gr` : '—'}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                    {s.grain !== 'none' && <Chip size="small" variant="outlined" label={`Lif: ${GRAIN_STOCK_LABEL[s.grain]}`} />}
                    {s.sourceJobId !== null && <Chip size="small" color="secondary" variant="outlined" component={Link} to={`/gecmis/${s.sourceJobId}`} clickable label={`İş #${s.sourceJobId}`} />}
                    {s.notes && <Tooltip title={s.notes}><Chip size="small" variant="outlined" label="Not" /></Tooltip>}
                  </Stack>
                </TableCell>
                {kind === 'offcut' && <TableCell><Typography variant="caption">{new Date(s.createdAt).toLocaleDateString('tr-TR')}</Typography></TableCell>}
                <TableCell>
                  {onToggleStatus ? (
                    <Switch size="small" checked={s.status === 'active'} onChange={(e) => onToggleStatus(s, e.target.checked)} inputProps={{ 'aria-label': 'Kullanılabilir' }} />
                  ) : (
                    <Chip size="small" color={s.status === 'active' ? 'success' : 'default'} variant="outlined" label={s.status === 'active' ? 'Açık' : 'Kapalı'} />
                  )}
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <IconButton size="small" aria-label="Düzenle" onClick={() => onEdit(s)}><EditIcon fontSize="small" /></IconButton>
                  <IconButton size="small" aria-label="Sil" onClick={() => onDelete(s)}><DeleteIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {rows.length === 0 && <EmptyState title="Kayıt bulunamadı" hint="Filtreleri değiştirin veya yeni bir kayıt ekleyin." />}
      <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider', display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary">{fmtInt(rows.length)} kayıt</Typography>
        <Typography variant="caption" color="text.secondary">Toplam alan: {fmtArea(totalArea)}</Typography>
      </Box>
    </Paper>
  );
}
