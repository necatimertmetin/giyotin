import { Alert, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, FormGroup, Radio, RadioGroup, Stack, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import PrintIcon from '@mui/icons-material/PrintOutlined';
import { useState, type ReactElement } from 'react';
import { collectPieces, cutSteps, type Plan } from '../../engine';
import type { Hatch, PdfArtwork, PdfImage, PdfPaper, PieceStyle, SummaryPage } from '../export/layoutPdf';
import { getArtworkSource } from '../import/artworkSources';
import type { PieceInfo } from './viewerTypes';
import { fmtNum } from '../format';
import { PROFILE_LABEL } from '../labels';
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

/** What gets printed: the summary and the layouts, only the summary, or only the layouts. */
export type PdfContent = 'both' | 'summary' | 'layouts';

/** What the PDF carries besides the layouts. */
export interface PdfOptions {
  content: PdfContent;
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
 * The summary for the whole plan, readable without the layout pages: the plan at a glance, the layouts with their
 * paper and sheet counts, then per layout what one sheet holds of each product, and finally the order check.
 */
export function summaryOf(props: Pick<Props, 'plan' | 'pieces' | 'title'>): SummaryPage {
  const { plan } = props;
  const R = 'right' as const;
  const L = 'left' as const;
  const dims = (w: number, h: number): string => `${fmtNum(w)} × ${fmtNum(h)}`;
  const counts = plan.sheets.map((sheet) => {
    const m = new Map<string, number>();
    for (const p of collectPieces(sheet.tree)) m.set(p.pieceId, (m.get(p.pieceId) ?? 0) + 1);
    return m;
  });
  const perSheet = counts.map((m) => [...m.values()].reduce((a, n) => a + n, 0));
  const totalPieces = plan.sheets.reduce((a, s, i) => a + s.copies * perSheet[i]!, 0);
  const steps = cutSteps(plan);

  const layoutTable = {
    heading: 'Kalıplar',
    widths: [16, 54, 30, 22, 24, 16, 28],
    header: ['Kalıp', 'Kağıt', 'Ölçü (mm)', 'Tabaka', 'Tabakada', 'Çeşit', 'Toplam parça'],
    align: [L, L, L, R, R, R, R],
    rows: [
      ...plan.sheets.map((s, i) => [String(i + 1), s.stockName, dims(s.width, s.height), num(s.copies), num(perSheet[i]!), num(counts[i]!.size), num(perSheet[i]! * s.copies)]),
      ['', 'Toplam', '', num(plan.totals.sheetCount), '', '', num(totalPieces)],
    ],
    total: true,
  };

  const perLayout = plan.sheets.map((s, i) => ({
    heading: `Kalıp ${i + 1} — ${s.stockName} (${dims(s.width, s.height)} mm) — ${num(s.copies)} tabaka — bir tabakada ${num(perSheet[i]!)} parça, ${num(counts[i]!.size)} çeşit`,
    widths: [12, 80, 30, 30, 38],
    header: ['Kod', 'Ürün', 'Ölçü (mm)', 'Bir tabakada', `Toplam (× ${num(s.copies)})`],
    align: [L, L, L, R, R],
    rows: [...props.pieces.values()]
      .filter((p) => counts[i]!.has(p.id))
      .map((p) => {
        const n = counts[i]!.get(p.id)!;
        return [p.code, p.name, dims(p.width, p.height), num(n), num(n * s.copies)];
      }),
  }));

  const orderRows = [...props.pieces.values()]
    .filter((p) => p.quantity > 0 || (plan.placed[p.id] ?? 0) > 0)
    .map((p) => {
      const placed = plan.placed[p.id] ?? 0;
      const diff = placed - p.quantity;
      return [p.code, p.name, dims(p.width, p.height), num(p.quantity), num(placed), diff === 0 ? 'tam' : diff > 0 ? `+${num(diff)} fazla` : `${num(-diff)} eksik`];
    });

  return {
    title: `${props.title} — kesim özeti${plan.label ? ` (${PROFILE_LABEL[plan.label] ?? plan.label})` : ''}`,
    lead: [
      `${num(plan.sheets.length)} çeşit kalıp, toplam ${num(plan.totals.sheetCount)} tabaka, ${num(totalPieces)} parça.`,
      `${num(steps)} kesim adımı (her kalıp istif halinde bir kez kesilir), kağıt kullanımı %${fmtNum(plan.totals.utilization * 100, 1)}.`,
    ],
    tables: [
      layoutTable,
      ...perLayout,
      {
        heading: 'Sipariş kontrolü',
        widths: [12, 74, 28, 24, 24, 28],
        header: ['Kod', 'Ürün', 'Ölçü (mm)', 'Sipariş', 'Kesilen', 'Fark'],
        align: [L, L, L, R, R, R],
        rows: orderRows,
      },
    ],
    notes: plan.fulfilled ? [] : ['Bu planda istenen adetler tam tamamlanamadı; eksikler "Fark" sütununda.'],
  };
}

/** The PDF, and the names of products printed from their preview image because no vector original was found. */
async function makePdf(props: Props, paper: PdfPaper, all: boolean, cutLines: boolean, opts: PdfOptions): Promise<{ blob: Blob; raster: string[] }> {
  const { buildLayoutPdf } = await import('../export/layoutPdf');
  const summary = opts.content !== 'layouts';
  const layouts = opts.content !== 'summary';
  const artworks = new Map<string, PdfArtwork>();
  const raster: string[] = [];
  for (const [id, info] of props.pieces) {
    if (!info.artwork || !layouts) continue;
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
    .filter((_, i) => layouts && (all || i === props.sheetIndex));
  const font = summary || opts.pieceLabels ? await loadCaptionFont() : undefined;
  const bytes = await buildLayoutPdf({ title: props.title, sheets, paper, artworks, cutLines, font, summary: summary ? summaryOf(props) : undefined });
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), raster };
}

const fileName = (title: string, content: PdfContent): string => `${title.replace(/[\\/:*?"<>|]+/g, '').trim() || 'kesim'} - ${content === 'summary' ? 'ozet' : 'kalip'}.pdf`;

const CONTENT_KEY = 'giyotin.pdfContent';
/** The last choice is remembered per browser: whoever prints only summaries should not have to pick it every time. */
function loadContent(): PdfContent {
  try {
    const v = localStorage.getItem(CONTENT_KEY);
    if (v === 'both' || v === 'summary' || v === 'layouts') return v;
  } catch {
    /* storage unavailable */
  }
  return 'both';
}

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
  const [content, setContentState] = useState<PdfContent>(loadContent);
  const setContent = (c: PdfContent): void => {
    setContentState(c);
    try {
      localStorage.setItem(CONTENT_KEY, c);
    } catch {
      /* storage unavailable: the choice just is not remembered */
    }
  };
  const layouts = content !== 'summary';
  const [pieceLabels, setPieceLabels] = useState(false);
  const [hatch, setHatch] = useState(false);
  const [busy, setBusy] = useState<'download' | 'print' | null>(null);
  const many = plan.sheets.length > 1;
  const sheet = plan.sheets[sheetIndex] ?? plan.sheets[0];

  const run = async (action: 'download' | 'print'): Promise<void> => {
    setBusy(action);
    try {
      const { blob, raster } = await makePdf(props, paper, many && all, cutLines, { content, pieceLabels, hatch });
      if (raster.length > 0) toast(`Önizleme görseliyle basıldı (vektörel değil): ${raster.join(', ')}. Vektörel baskı, bu tarayıcıda eklenmiş PDF/AI dosyalarında olur.`, 'info');
      if (action === 'print') printBlob(blob);
      else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName(props.title, content);
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
      <DialogTitle>PDF / Yazdır</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <div>
            <Typography variant="subtitle2">Ne basılsın</Typography>
            <RadioGroup value={content} onChange={(e) => setContent(e.target.value as PdfContent)}>
              <FormControlLabel value="both" control={<Radio />} label="Özet + kalıp sayfaları" data-testid="pdf-content-both" />
              <FormControlLabel value="summary" control={<Radio />} label="Sadece özet (kalıplar, her kalıpta hangi üründen kaç tane, toplamlar)" data-testid="pdf-content-summary" />
              <FormControlLabel value="layouts" control={<Radio />} label="Sadece kalıp sayfaları" data-testid="pdf-content-layouts" />
            </RadioGroup>
          </div>
          {layouts && (<>
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
            <Typography variant="subtitle2">Kalıp sayfalarında</Typography>
            <FormGroup>
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
          </>)}
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
