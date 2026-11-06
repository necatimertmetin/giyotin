import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Paper, Stack, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import UploadIcon from '@mui/icons-material/FileUploadOutlined';
import { useRef, useState, type ReactElement } from 'react';
import type { ImportSummary } from '../../shared/api';
import { makeBackup, readBackup, restoreBackup, type BackupFile } from '../backup';
import { fmtInt } from '../format';
import { useToast } from '../hooks';

const count = (b: BackupFile, table: string): string => fmtInt(b.tables[table]?.length ?? 0);

/** Moves everything to another computer or browser: one file out, one file in. */
export function BackupSettings({ wide = false }: { wide?: boolean }): ReactElement {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [done, setDone] = useState<ImportSummary | null>(null);

  const download = async (): Promise<void> => {
    setExporting(true);
    try {
      const { blob, fileName } = await makeBackup();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) {
      toast(e instanceof Error ? `Yedek alınamadı: ${e.message}` : 'Yedek alınamadı.', 'error');
    } finally {
      setExporting(false);
    }
  };

  const choose = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      setPending(await readBackup(file));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Dosya okunamadı.', 'error');
    }
  };

  const restore = async (): Promise<void> => {
    if (!pending) return;
    setRestoring(true);
    try {
      setDone(await restoreBackup(pending));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Yedek yüklenemedi.', 'error');
    } finally {
      setRestoring(false);
      setPending(null);
    }
  };

  return (
    <Paper sx={{ p: 2.5, maxWidth: wide ? undefined : 720, mt: 3 }}>
      <Typography variant="h6">Yedekleme</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Envanter, siparişler, kesim geçmişi, artıklar ve ayarlar tek dosyada. Başka bir bilgisayarda içe aktarınca oradaki verilerin üzerine eklenir; hiçbir şey silinmez.</Typography>
      <Stack direction="row" spacing={1.5}>
        <Button variant="outlined" startIcon={exporting ? <CircularProgress size={16} /> : <DownloadIcon />} disabled={exporting} onClick={() => void download()} data-testid="backup-export">Dışa aktar</Button>
        <Button variant="outlined" startIcon={<UploadIcon />} onClick={() => input.current?.click()} data-testid="backup-import">İçe aktar</Button>
        <input
          ref={input}
          type="file"
          hidden
          accept=".json,application/json"
          data-testid="backup-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            void choose(file);
          }}
        />
      </Stack>

      <Dialog open={pending !== null} onClose={restoring ? undefined : () => setPending(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Yedek eklensin mi?</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>Mevcut veriler silinmez, yedekteki kayıtlar <b>üzerine eklenir</b>. Burada zaten olan kayıtlar atlanır. Makine ve ayarlarınız değişmez.</Alert>
          {pending && (
            <DialogContentText data-testid="backup-summary">
              {new Date(pending.exportedAt).toLocaleString('tr-TR')} tarihli yedek: {count(pending, 'stock_items')} stok kaydı, {count(pending, 'orders')} sipariş, {count(pending, 'jobs')} kesim işi.
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)} disabled={restoring}>Vazgeç</Button>
          <Button variant="contained" disabled={restoring} startIcon={restoring ? <CircularProgress size={16} color="inherit" /> : undefined} onClick={() => void restore()} data-testid="backup-confirm">Üzerine ekle</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={done !== null} maxWidth="xs" fullWidth>
        <DialogTitle>Yedek eklendi</DialogTitle>
        <DialogContent>
          {done && <DialogContentText data-testid="backup-result">{fmtInt(done.stock)} stok kaydı, {fmtInt(done.orders)} sipariş, {fmtInt(done.jobs)} kesim işi eklendi.{done.skipped > 0 ? ` Zaten var olan ${fmtInt(done.skipped)} kayıt atlandı.` : ''}</DialogContentText>}
        </DialogContent>
        <DialogActions>
          {/* Every page and the machine setting hold data from before the import. */}
          <Button variant="contained" onClick={() => window.location.reload()} data-testid="backup-done">Tamam</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
