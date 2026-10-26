import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { useMemo, useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { ErrorNote, PageHeader } from '../components/common';
import { Metric } from '../components/PlanStats';
import { fmtArea, fmtDate, fmtInt, fmtNum, fmtPercent } from '../format';
import { useLoad, useToast } from '../hooks';
import { FONT_MONO } from '../theme';

export function DashboardPage(): ReactElement {
  const stock = useLoad(api.stock.list);
  const jobs = useLoad(api.jobs.list);
  const orders = useLoad(api.orders.list);
  const navigate = useNavigate();
  const toast = useToast();
  const [resetOpen, setResetOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [resetting, setResetting] = useState(false);
  const canReset = typed.trim().toLocaleUpperCase('tr-TR') === 'SİL';

  const resetAll = async (): Promise<void> => {
    setResetting(true);
    try {
      await api.admin.resetAll();
      toast('Tüm veriler silindi.');
      setResetOpen(false);
      setTyped('');
      stock.reload();
      jobs.reload();
      orders.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Silinemedi.', 'error');
    } finally {
      setResetting(false);
    }
  };

  const summary = useMemo(() => {
    const items = stock.data ?? [];
    const sheets = items.filter((s) => s.kind === 'sheet' && s.status === 'active');
    const offcuts = items.filter((s) => s.kind === 'offcut' && s.status === 'active');
    const area = (l: typeof items): number => l.reduce((a, s) => a + s.width * s.height * s.quantity, 0);
    const byMaterial = new Map<string, { label: string; qty: number; area: number }>();
    for (const s of items.filter((x) => x.status === 'active' && x.quantity > 0)) {
      const cur = byMaterial.get(s.materialKey) ?? { label: [s.name, s.gsm ? `${s.gsm} gr` : null, s.color, s.finish].filter(Boolean).join(' · '), qty: 0, area: 0 };
      cur.qty += s.quantity;
      cur.area += s.width * s.height * s.quantity;
      byMaterial.set(s.materialKey, cur);
    }
    return {
      sheetQty: sheets.reduce((a, s) => a + s.quantity, 0),
      sheetArea: area(sheets),
      offcutQty: offcuts.reduce((a, s) => a + s.quantity, 0),
      offcutArea: area(offcuts),
      depleted: items.filter((s) => s.kind === 'sheet' && s.status === 'active' && s.quantity === 0).length,
      materials: [...byMaterial.values()].sort((a, b) => b.area - a.area),
    };
  }, [stock.data]);

  const recentJobs = (jobs.data ?? []).slice(0, 6);
  const avgUtil = recentJobs.length > 0 ? recentJobs.reduce((a, j) => a + j.utilization, 0) / recentJobs.length : null;
  const drafts = (orders.data ?? []).filter((o) => o.status === 'draft');

  return (
    <>
      <PageHeader
        title="Panel"
        subtitle="Stok, artık parça ve son kesim işlerinin kısa özeti."
        actions={<Button variant="contained" component={Link} to="/yeni-is">Yeni kesim işi</Button>}
      />
      <ErrorNote message={stock.error ?? jobs.error ?? orders.error} />
      {(stock.loading || jobs.loading) && <LinearProgress sx={{ mb: 2 }} />}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 1.5, mb: 3 }}>
        <Metric label="Kullanılabilir tabaka" value={fmtInt(summary.sheetQty)} hint={fmtArea(summary.sheetArea)} />
        <Metric label="Yeniden kullanılabilir artık" value={fmtInt(summary.offcutQty)} hint={fmtArea(summary.offcutArea)} tone="good" />
        <Metric label="Açık siparişler" value={fmtInt(drafts.length)} hint="henüz onaylanmamış" />
        <Metric label="Son işlerde ort. kullanım" value={avgUtil === null ? '—' : fmtPercent(avgUtil)} hint={recentJobs.length ? `son ${recentJobs.length} iş` : 'henüz iş yok'} />
      </Box>

      {summary.depleted > 0 && <Alert severity="warning" sx={{ mb: 2 }}>{summary.depleted} stok kaleminin adedi sıfıra düştü. <Link to="/envanter">Envantere git</Link></Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 2.5 }}>
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>Stok (kağıt cinsine göre)</Typography>
          <Table size="small">
            <TableHead><TableRow><TableCell>Kağıt</TableCell><TableCell align="right">Adet</TableCell><TableCell align="right">Alan</TableCell></TableRow></TableHead>
            <TableBody>
              {summary.materials.map((m) => (
                <TableRow key={m.label}>
                  <TableCell>{m.label}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: FONT_MONO }}>{fmtInt(m.qty)}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: FONT_MONO }}>{fmtArea(m.area)}</TableCell>
                </TableRow>
              ))}
              {summary.materials.length === 0 && <TableRow><TableCell colSpan={3}><Typography variant="body2" color="text.secondary">Stok kaydı yok.</Typography></TableCell></TableRow>}
            </TableBody>
          </Table>
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>Aktif siparişler</Typography>
          {drafts.length === 0 && <Typography variant="body2" color="text.secondary">Açık sipariş yok.</Typography>}
          <Stack spacing={0.5}>
            {drafts.slice(0, 6).map((o) => (
              <Stack key={o.id} direction="row" justifyContent="space-between" sx={{ py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{o.name}</Typography>
                <Typography variant="body2" color="text.secondary">{o.lines.length} kalem · {fmtInt(o.lines.reduce((a, l) => a + l.quantity, 0))} adet</Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>

        <Paper sx={{ p: 2, gridColumn: { lg: '1 / -1' } }}>
          <Typography variant="h6" sx={{ mb: 1 }}>Son kesim işleri</Typography>
          <Table size="small">
            <TableHead>
              <TableRow><TableCell>İş</TableCell><TableCell>Sipariş</TableCell><TableCell>Tarih</TableCell><TableCell align="right">Tabaka</TableCell><TableCell sx={{ width: 220 }}>Malzeme kullanımı</TableCell></TableRow>
            </TableHead>
            <TableBody>
              {recentJobs.map((j) => (
                <TableRow key={j.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/gecmis/${j.id}`)}>
                  <TableCell sx={{ fontFamily: FONT_MONO }}>#{j.id}</TableCell>
                  <TableCell>{j.orderName}</TableCell>
                  <TableCell>{fmtDate(j.createdAt)}</TableCell>
                  <TableCell align="right" sx={{ fontFamily: FONT_MONO }}>{fmtInt(j.sheetCount)}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <LinearProgress variant="determinate" value={j.utilization * 100} sx={{ flex: 1, height: 8, borderRadius: 1 }} color={j.utilization >= 0.85 ? 'success' : 'primary'} />
                      <Typography variant="caption" sx={{ fontFamily: FONT_MONO, minWidth: 48 }}>{fmtNum(j.utilization * 100, 1)}%</Typography>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
              {recentJobs.length === 0 && <TableRow><TableCell colSpan={5}><Typography variant="body2" color="text.secondary">Henüz onaylanmış kesim işi yok.</Typography></TableCell></TableRow>}
            </TableBody>
          </Table>
        </Paper>
      </Box>

      <Paper sx={{ p: 2, mt: 3, borderColor: 'error.main' }} data-testid="danger-zone">
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1.5}>
          <Box>
            <Typography sx={{ fontWeight: 700 }} color="error">Tehlikeli bölge</Typography>
            <Typography variant="body2" color="text.secondary">Stok, artıklar, siparişler, geçmiş işler ve profiller dahil tüm verileri siler. Bu işlem geri alınamaz.</Typography>
          </Box>
          <Button color="error" variant="outlined" onClick={() => { setTyped(''); setResetOpen(true); }} data-testid="open-reset">Tüm veriyi sil…</Button>
        </Stack>
      </Paper>

      <Dialog open={resetOpen} onClose={resetting ? undefined : () => setResetOpen(false)} fullWidth maxWidth="xs" aria-labelledby="reset-title">
        <DialogTitle id="reset-title">Tüm veriler silinsin mi?</DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mb: 2 }}>
            Tüm kağıt stokları, artık parçalar, siparişler, kesim geçmişi ve ayar profilleri <b>kalıcı olarak silinir</b>. Geri alma yoktur.
          </Alert>
          <Typography variant="body2" sx={{ mb: 1 }}>Onaylamak için aşağıya <b>SİL</b> yazın.</Typography>
          <TextField autoFocus fullWidth value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="SİL" inputProps={{ 'aria-label': 'Onay metni', 'data-testid': 'reset-confirm-input' }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetOpen(false)} disabled={resetting}>Vazgeç</Button>
          <Button color="error" variant="contained" disabled={!canReset || resetting} onClick={() => void resetAll()} data-testid="reset-confirm">Her şeyi sil</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
