import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Radio, RadioGroup, Stack, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import PrintIcon from '@mui/icons-material/PrintOutlined';
import { useState, type ReactElement } from 'react';
import type { OptimizationInput, Plan } from '../../engine';
import type { PdfPaper } from '../export/layoutPdf';
import { fmtNum } from '../format';
import { useToast } from '../hooks';

interface Props {
  open: boolean;
  onClose: () => void;
  plan: Plan;
  input: OptimizationInput;
  /** Order name, printed in the header and used for the file name. */
  title: string;
  planLabel: string;
  sheetIndex: number;
}

async function makePdf(props: Props, paper: PdfPaper, all: boolean): Promise<Blob> {
  const [{ buildLayoutPdf }, regularUrl, boldUrl] = await Promise.all([
    import('../export/layoutPdf'),
    import('pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf?url').then((m) => m.default),
    import('pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf?url').then((m) => m.default),
  ]);
  const font = async (url: string): Promise<Uint8Array> => new Uint8Array(await (await fetch(url)).arrayBuffer());
  const [regular, bold] = await Promise.all([font(regularUrl), font(boldUrl)]);
  const sheets = props.plan.sheets.map((sheet, i) => ({ sheet, number: i + 1 })).filter((_, i) => all || i === props.sheetIndex);
  const bytes = await buildLayoutPdf({
    title: props.title,
    planLabel: props.planLabel,
    sheets,
    totalSheets: props.plan.sheets.length,
    pieceNames: new Map(props.input.pieces.map((p) => [p.id, p.name])),
    paper,
    fonts: { regular, bold },
  });
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

const fileName = (title: string): string => `${title.replace(/[\\/:*?"<>|]+/g, '').trim() || 'kesim'} - kalip.pdf`;

/** Prints the PDF through a hidden frame, so the browser's own print dialog opens on it. */
function printBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.src = url;
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
  };
  document.body.appendChild(frame);
  // Long enough for the print dialog; the frame is useless afterwards.
  setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, 120_000);
}

/** Download or print the cutting layouts as PDF, on A4 or at the real sheet size. */
export function PdfExportDialog(props: Props): ReactElement {
  const { open, onClose, plan, sheetIndex } = props;
  const toast = useToast();
  const [paper, setPaper] = useState<PdfPaper>('a4');
  const [all, setAll] = useState(true);
  const [busy, setBusy] = useState<'download' | 'print' | null>(null);
  const many = plan.sheets.length > 1;
  const sheet = plan.sheets[sheetIndex] ?? plan.sheets[0];

  const run = async (action: 'download' | 'print'): Promise<void> => {
    setBusy(action);
    try {
      const blob = await makePdf(props, paper, many && all);
      if (action === 'print') printBlob(blob);
      else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName(props.title);
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      }
      onClose();
    } catch (e) {
      toast(e instanceof Error ? `PDF oluşturulamadı: ${e.message}` : 'PDF oluşturulamadı.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth data-testid="pdf-dialog">
      <DialogTitle>Kalıbı PDF olarak al</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <div>
            <Typography variant="subtitle2">Kağıt boyutu</Typography>
            <RadioGroup value={paper} onChange={(e) => setPaper(e.target.value as PdfPaper)}>
              <FormControlLabel value="a4" control={<Radio />} label="A4 — kalıp sayfaya sığdırılır, başlık ve açıklamalarla" data-testid="pdf-paper-a4" />
              <FormControlLabel
                value="sheet"
                control={<Radio />}
                label={sheet ? `Kalıp ebadında — gerçek ölçü 1:1 (${fmtNum(sheet.width)} × ${fmtNum(sheet.height)} mm)` : 'Kalıp ebadında — gerçek ölçü 1:1'}
                data-testid="pdf-paper-sheet"
              />
            </RadioGroup>
          </div>
          {many && (
            <div>
              <Typography variant="subtitle2">Kalıplar</Typography>
              <RadioGroup value={all ? 'all' : 'one'} onChange={(e) => setAll(e.target.value === 'all')}>
                <FormControlLabel value="all" control={<Radio />} label={`Tüm kalıplar (${plan.sheets.length} sayfa)`} />
                <FormControlLabel value="one" control={<Radio />} label={`Sadece Kalıp ${sheetIndex + 1}`} />
              </RadioGroup>
            </div>
          )}
          {paper === 'sheet' && (
            <Alert severity="info">Yazdırırken ölçeklemeyi <b>Gerçek boyut / %100</b> seçin. Kağıttan büyük kalıplar için plotter gerekir.</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy !== null}>Vazgeç</Button>
        <Button startIcon={busy === 'print' ? <CircularProgress size={16} /> : <PrintIcon />} onClick={() => void run('print')} disabled={busy !== null} data-testid="pdf-print">Yazdır</Button>
        <Button variant="contained" startIcon={busy === 'download' ? <CircularProgress size={16} color="inherit" /> : <DownloadIcon />} onClick={() => void run('download')} disabled={busy !== null} data-testid="pdf-download">PDF indir</Button>
      </DialogActions>
    </Dialog>
  );
}
