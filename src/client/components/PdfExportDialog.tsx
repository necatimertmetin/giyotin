import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Radio, RadioGroup, Stack, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import PrintIcon from '@mui/icons-material/PrintOutlined';
import { useState, type ReactElement } from 'react';
import type { Plan } from '../../engine';
import type { PdfArtwork, PdfImage, PdfPaper } from '../export/layoutPdf';
import { getArtworkSource } from '../import/artworkSources';
import type { PieceInfo } from './viewerTypes';
import { fmtNum } from '../format';
import { useToast } from '../hooks';

interface Props {
  open: boolean;
  onClose: () => void;
  plan: Plan;
  /** Products of the plan; their artwork goes onto the pieces. */
  pieces: Map<string, PieceInfo>;
  /** Artwork id per piece id, to find the vector original. */
  artworkIds: Map<string, string>;
  /** Order name, used for the document title and the file name. */
  title: string;
  sheetIndex: number;
  /** Whether layout i is shown turned by 90° in the viewer; the PDF shows it the same way. */
  sidewaysOf: (i: number) => boolean;
}

/** Product previews are WebP/PNG data URLs; PDF takes PNG or JPEG, so they are redrawn as PNG. */
async function toPng(dataUrl: string): Promise<PdfImage> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('ürün görseli dönüştürülemedi');
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'png' };
}

/** The PDF, and the names of products printed from their preview image because no vector original was found. */
async function makePdf(props: Props, paper: PdfPaper, all: boolean, cutLines: boolean): Promise<{ blob: Blob; raster: string[] }> {
  const { buildLayoutPdf } = await import('../export/layoutPdf');
  const artworks = new Map<string, PdfArtwork>();
  const raster: string[] = [];
  for (const [id, info] of props.pieces) {
    if (!info.artwork) continue;
    const artworkId = props.artworkIds.get(id);
    const source = artworkId ? await getArtworkSource(artworkId) : null;
    if (source) artworks.set(id, { kind: 'vector', pdf: source.pdf, box: source.box });
    else {
      artworks.set(id, { kind: 'image', ...(await toPng(info.artwork)) });
      raster.push(info.name);
    }
  }
  const sheets = props.plan.sheets.map((sheet, i) => ({ sheet, sideways: props.sidewaysOf(i) })).filter((_, i) => all || i === props.sheetIndex);
  const bytes = await buildLayoutPdf({ title: props.title, sheets, paper, artworks, cutLines });
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), raster };
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
  const [cutLines, setCutLines] = useState(true);
  const [busy, setBusy] = useState<'download' | 'print' | null>(null);
  const many = plan.sheets.length > 1;
  const sheet = plan.sheets[sheetIndex] ?? plan.sheets[0];

  const run = async (action: 'download' | 'print'): Promise<void> => {
    setBusy(action);
    try {
      const { blob, raster } = await makePdf(props, paper, many && all, cutLines);
      if (raster.length > 0) toast(`Önizleme görseliyle basıldı (vektörel değil): ${raster.join(', ')}. Vektörel baskı, bu tarayıcıda eklenmiş PDF/AI dosyalarında olur.`, 'info');
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
              <FormControlLabel value="a4" control={<Radio />} label="A4 — kalıp sayfaya sığdırılır" data-testid="pdf-paper-a4" />
              <FormControlLabel
                value="sheet"
                control={<Radio />}
                label={sheet ? `Kalıp ebadında — gerçek ölçü 1:1 (${fmtNum(sheet.width)} × ${fmtNum(sheet.height)} mm)` : 'Kalıp ebadında — gerçek ölçü 1:1'}
                data-testid="pdf-paper-sheet"
              />
            </RadioGroup>
          </div>
          <div>
            <Typography variant="subtitle2">Kesim çizgileri</Typography>
            <RadioGroup row value={cutLines ? 'on' : 'off'} onChange={(e) => setCutLines(e.target.value === 'on')}>
              <FormControlLabel value="on" control={<Radio />} label="Olsun" data-testid="pdf-lines-on" />
              <FormControlLabel value="off" control={<Radio />} label="Olmasın" data-testid="pdf-lines-off" />
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
