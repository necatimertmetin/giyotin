import { Alert, Button, Chip, LinearProgress, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import type { ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { EmptyState, ErrorNote, PageHeader } from '../components/common';
import { PlanView } from '../components/PlanView';
import { fmtArea, fmtDate, fmtInt, fmtMoney, fmtNum, fmtPercent } from '../format';
import { useLoad, useToast } from '../hooks';
import { FONT_MONO } from '../theme';

export function HistoryPage(): ReactElement {
  const jobs = useLoad(api.jobs.list);
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Kesim Geçmişi" subtitle="Onaylanmış işler ve kesim planları. Stok kayıtları sonradan değişse bile her işin özgün planı korunur." />
      <ErrorNote message={jobs.error} />
      {jobs.loading && !jobs.data && <LinearProgress />}
      {jobs.data && (
        <Paper>
          {jobs.data.length === 0 ? (
            <EmptyState title="Henüz onaylanmış iş yok" hint="Bir kesim planını onayladığınızda burada görünür." action={<Button variant="contained" component={Link} to="/yeni-is">Yeni kesim işi</Button>} />
          ) : (
            <TableContainer>
              <Table size="small" data-testid="history-table">
                <TableHead>
                  <TableRow>
                    <TableCell>İş</TableCell>
                    <TableCell>Sipariş</TableCell>
                    <TableCell>Tarih</TableCell>
                    <TableCell align="right">Tabaka</TableCell>
                    <TableCell align="right">Kullanım</TableCell>
                    <TableCell align="right">Fire</TableCell>
                    <TableCell align="right">Artık</TableCell>
                    <TableCell align="right">Kesim</TableCell>
                    <TableCell align="right">Maliyet</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {jobs.data.map((j) => (
                    <TableRow key={j.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/gecmis/${j.id}`)} data-testid="history-row">
                      <TableCell sx={{ fontFamily: FONT_MONO, fontWeight: 700 }}>#{j.id}</TableCell>
                      <TableCell>{j.orderName}</TableCell>
                      <TableCell>{fmtDate(j.createdAt)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: FONT_MONO }}>{fmtInt(j.sheetCount)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: FONT_MONO }}>{fmtPercent(j.utilization)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: FONT_MONO }}>{fmtArea(j.wasteArea)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: FONT_MONO }}>{fmtArea(j.offcutArea)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: FONT_MONO }}>{fmtInt(j.cuts)}</TableCell>
                      <TableCell align="right" sx={{ fontFamily: FONT_MONO }}>{j.cost === null ? '—' : fmtMoney(j.cost)}</TableCell>
                      <TableCell>{!j.fulfilled && <Chip size="small" color="warning" label="Eksik" />}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      )}
    </>
  );
}

/** Detail of a confirmed job: the original plan, plus handling of the offcuts it produced. */
export function JobPage(): ReactElement {
  const { jobId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const job = useLoad(() => api.jobs.get(Number(jobId)), [jobId]);
  const data = job.data;

  const act = async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
    try {
      await fn();
      toast(ok);
      job.reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'İşlem başarısız.', 'error');
    }
  };

  return (
    <>
      <PageHeader
        title={data ? `İş #${data.id} — ${data.orderName}` : 'İş'}
        subtitle={data ? `Onay tarihi: ${fmtDate(data.createdAt)} · Bu plan, onay anındaki stok ve ayarlarla kaydedilmiştir.` : undefined}
        actions={<Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/gecmis')}>Geçmişe dön</Button>}
      />
      <ErrorNote message={job.error} />
      {job.loading && !data && <LinearProgress />}
      {data && (
        <PlanView
          plan={data.plan}
          title={data.orderName}
          input={data.input}
          settings={data.settings}
          actions={
            <Paper sx={{ p: 2 }} data-testid="job-offcuts">
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Bu işte oluşan yeniden kullanılabilir artıklar</Typography>
              {data.offcuts.length === 0 && <Typography variant="body2" color="text.secondary">Bu işte yeniden kullanılabilir artık oluşmadı.</Typography>}
              <Stack spacing={1}>
                {data.offcuts.map((o) => (
                  <Stack key={o.id} direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap data-testid="job-offcut-row">
                    <Typography sx={{ fontFamily: FONT_MONO, minWidth: 220 }}>Kalıp {o.sheetIndex + 1}: {fmtNum(o.width)} × {fmtNum(o.height)} mm × {fmtInt(o.quantity)}</Typography>
                    {o.status === 'pending' && (
                      <>
                        <Button size="small" variant="contained" onClick={() => void act(() => api.jobs.addOffcut(data.id, o.id), 'Artık envantere eklendi.')} data-testid="add-offcut">Envantere ekle</Button>
                        <Button size="small" color="inherit" onClick={() => void act(() => api.jobs.discardOffcut(data.id, o.id), 'Artık atıldı olarak işaretlendi.')}>Ekleme</Button>
                      </>
                    )}
                    {o.status === 'added' && <Chip size="small" color="success" label="Envantere eklendi" component={Link} to="/artiklar" clickable />}
                    {o.status === 'discarded' && <Chip size="small" label="Eklenmedi" />}
                  </Stack>
                ))}
              </Stack>
              {!data.plan.fulfilled && <Alert severity="warning" sx={{ mt: 2 }}>Bu iş siparişi tamamen karşılamıyordu; eksik miktarlar yukarıdaki özette yer alır.</Alert>}
            </Paper>
          }
        />
      )}
    </>
  );
}
