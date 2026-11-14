import { Alert, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, FormGroup, Radio, RadioGroup, Stack, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import PrintIcon from '@mui/icons-material/PrintOutlined';
import { useState, type ReactElement } from 'react';
import { collectPieces, cutSteps, type Plan } from '../../engine';
import type { Hatch, PdfArtwork, PdfImage, PdfPaper, PieceStyle, SummaryPage } from '../export/layoutPdf';
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

/** What the PDF carries besides the layouts. */
export interface PdfOptions {
  /** A summary page (ordered, cut and excess per product, layouts, totals) printed first. */
  summary: boolean;
  /** Written in the middle of each piece of the layouts: the product name and how many are cut from it. Off by default. */
  pieceLabels: boolean;
  /** Each product gets its own hatch pattern on the pieces without artwork. Off by default. */
  hatch: boolean;
}

/** Hatch patterns in the order products get them; a product keeps its pattern on every layout. */
const HATCHES: Hatch[] = ['diag', 'anti', 'horiz', 'vert', 'cross', 'dots'];

/** Per piece of one layout: its text lines and hatch pattern, as the options ask. */
function stylesOf(props: Props, sheet: Plan['sheets'][number], opts: PdfOptions): Map<string, PieceStyle> {
  const counts = new Map<string, number>();
  for (const p of collectPieces(sheet.tree)) counts.set(p.pieceId, (counts.get(p.pieceId) ?? 0) + 1);
  const styles = new Map<string, PieceStyle>();
  let index = 0;
  for (const [id, info] of props.pieces) {
    const n = counts.get(id) ?? 0;
    const hatch = opts.hatch ? HATCHES[index % HATCHES.length]! : null;
    index++;
    if (n === 0) continue;
    const lines = opts.pieceLabels ? [info.name, sheet.copies > 1 ? `${n} adet × ${sheet.copies} tabaka = ${n * sheet.copies}` : `${n} adet`] : [];
    styles.set(id, { lines, hatch });
  }
  return styles;
}

/** Turkish letters need an embedded font; the same file the browser loads for the page itself. */
async function loadCaptionFont(): Promise<Uint8Array> {
  const res = await fetch(`${import.meta.env.BASE_URL}fonts/LiberationSans-Regular.ttf`);
  if (!res.ok) throw new Error('yazı tipi yüklenemedi');
  return new Uint8Array(await res.arrayBuffer());
}

const num = (n: number): string => n.toLocaleString('tr-TR');

/**
 * The summary page for the whole plan: per product how many were ordered, cut and over or short, then per layout
 * its stock, sheet count and pieces, and the totals. Excess is the planner's overproduction where it reports one.
 */
function summaryOf(props: Props): SummaryPage {
  const { plan } = props;
  const productRows: string[][] = [];
  for (const [id, info] of props.pieces) {
    const placed = plan.placed[id] ?? 0;
    const over = plan.overproduced?.[id] ?? Math.max(0, placed - info.quantity);
    const short = Math.max(0, info.quantity - placed);
    productRows.push([info.name, num(info.quantity), num(placed), over > 0 ? num(over) : '–', short > 0 ? num(short) : '–']);
  }
  const layoutRows = plan.sheets.map((sheet, i) => {
    const pieces = collectPieces(sheet.tree).length;
    return [String(i + 1), sheet.stockName, num(sheet.copies), num(sheet.stats.cuts), num(pieces), num(pieces * sheet.copies)];
  });
  const notes = [
    `Toplam: ${num(plan.totals.sheetCount)} tabaka, ${num(cutSteps(plan))} kesim adımı, kağıt kullanımı %${fmtNum(plan.totals.utilization * 100)}.`,
    ...(plan.fulfilled ? [] : ['Bu planda istenen adetler tam tamamlanamadı; eksikler yukarıda.']),
  ];
  return {
    title: `${props.title} — kalıp özeti${plan.label ? ` (${plan.label})` : ''}`,
    tables: [
      { widths: [88, 25, 25, 25, 27], header: ['Ürün', 'İstenen', 'Kesilen', 'Fazla', 'Eksik'], rows: productRows },
      { widths: [14, 62, 24, 26, 30, 34], header: ['Kalıp', 'Stok', 'Tabaka', 'Kesim', 'Parça/tabaka', 'Toplam parça'], rows: layoutRows },
    ],
    notes,
  };
}

/** The PDF, and the names of products printed from their preview image because no vector original was found. */
async function makePdf(props: Props, paper: PdfPaper, all: boolean, cutLines: boolean, opts: PdfOptions): Promise<{ blob: Blob; raster: string[] }> {
  const { buildLayoutPdf } = await import('../export/layoutPdf');
  const { summary } = opts;
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
  const sheets = props.plan.sheets
    .map((sheet, i) => ({
      sheet,
      sideways: props.sidewaysOf(i),
      styles: opts.pieceLabels || opts.hatch ? stylesOf(props, sheet, opts) : undefined,
    }))
    .filter((_, i) => all || i === props.sheetIndex);
  const font = summary || opts.pieceLabels ? await loadCaptionFont() : undefined;
  const bytes = await buildLayoutPdf({ title: props.title, sheets, paper, artworks, cutLines, font, summary: summary ? summaryOf(props) : undefined });
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
  const [summary, setSummary] = useState(true);
  const [pieceLabels, setPieceLabels] = useState(false);
  const [hatch, setHatch] = useState(false);
  const [busy, setBusy] = useState<'download' | 'print' | null>(null);
  const many = plan.sheets.length > 1;
  const sheet = plan.sheets[sheetIndex] ?? plan.sheets[0];

  const run = async (action: 'download' | 'print'): Promise<void> => {
    setBusy(action);
    try {
      const { blob, raster } = await makePdf(props, paper, many && all, cutLines, { summary, pieceLabels, hatch });
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
          <div>
            <Typography variant="subtitle2">PDF'e eklenenler</Typography>
            <FormGroup>
              <FormControlLabel
                control={<Checkbox checked={summary} onChange={(e) => setSummary(e.target.checked)} data-testid="pdf-summary" />}
                label="Başa özet sayfası (ürün istenen/kesilen/fazla/eksik, kalıp tablosu, toplam)"
              />
              <FormControlLabel
                control={<Checkbox checked={pieceLabels} onChange={(e) => setPieceLabels(e.target.checked)} data-testid="pdf-piece-labels" />}
                label="Parçaların ortasına ürün adı ve kaç adet basılacağı"
              />
              <FormControlLabel
                control={<Checkbox checked={hatch} onChange={(e) => setHatch(e.target.checked)} data-testid="pdf-hatch" />}
                label="Her ürüne ayrı tarama deseni (görselsiz parçalarda)"
              />
            </FormGroup>
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
