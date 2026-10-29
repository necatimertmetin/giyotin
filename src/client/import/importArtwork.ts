import { baseName, kindOf, pageBox, pieceBox, postScriptBox, postScriptPart, ptToMm, svgSize, type Box } from './artworkFormat';

/** One product read from an artwork file (a file holds one product per page/artboard). */
export interface ImportedArtwork {
  name: string;
  /** Finished (trim) size in mm. */
  width: number;
  height: number;
  /** Image data URL, or null when the format gives no preview (EPS). */
  thumbnail: string | null;
  /** Something the user should double-check, in Turkish. */
  note: string | null;
}

/** Longest side of a stored preview, px. */
const THUMB_PX = 480;
const MAX_PAGES = 50;
const MAX_BYTES = 300 * 1024 * 1024;

export const ACCEPTED_EXTENSIONS = '.ai,.pdf,.svg,.eps,.cdr,.fh,.fh8,.fh9,.fh10,.fh11';

/** Reads the products of one artwork file. Throws an Error with a Turkish message the user can act on. */
export async function readArtworkFile(file: File): Promise<ImportedArtwork[]> {
  if (file.size > MAX_BYTES) throw new Error(`${file.name}: dosya çok büyük (${Math.round(file.size / 1048576)} MB).`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = baseName(file.name);
  switch (kindOf(file.name, bytes.subarray(0, 1024))) {
    case 'pdf':
      return readPdf(bytes, name);
    case 'postscript':
      return [readPostScript(bytes, name, /\.ai$/i.test(file.name))];
    case 'svg':
      return [await readSvg(new TextDecoder().decode(bytes), name)];
    case 'corel':
      throw new Error(`${file.name}: CorelDRAW dosyası doğrudan okunamıyor. Corel'de "Dosya → PDF olarak yayımla" ile PDF çıkarıp onu bırakın.`);
    case 'freehand':
      throw new Error(`${file.name}: FreeHand dosyası okunamıyor. FreeHand'den PDF veya EPS olarak dışa aktarıp onu bırakın.`);
    default:
      throw new Error(`${file.name}: desteklenmeyen dosya türü. AI, PDF, SVG veya EPS bırakın.`);
  }
}

async function readPdf(bytes: Uint8Array, name: string): Promise<ImportedArtwork[]> {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  // pdf.js takes ownership of (detaches) the buffer it is given, so hand it a copy.
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  try {
    const raw = new TextDecoder('latin1').decode(bytes);
    const pages = Math.min(doc.numPages, MAX_PAGES);
    const out: ImportedArtwork[] = [];
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const view = page.view as Box;
      const trim = page.ref ? pageBox(raw, page.ref.num, page.ref.gen, 'TrimBox') : null;
      const art = page.ref ? pageBox(raw, page.ref.num, page.ref.gen, 'ArtBox') : null;
      const { box, fromArt } = pieceBox(view, trim, art);
      const turned = page.rotate % 180 !== 0;
      const w = ptToMm(box[2] - box[0]);
      const h = ptToMm(box[3] - box[1]);

      const scale = THUMB_PX / Math.max(view[2] - view[0], view[3] - view[1]);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      // Crop the bleed away so the preview shows the finished piece (only for unrotated pages; rare otherwise).
      const crop = box !== view && !turned ? { x: (box[0] - view[0]) * scale, y: (view[3] - box[3]) * scale, w: (box[2] - box[0]) * scale, h: (box[3] - box[1]) * scale } : null;
      page.cleanup();

      out.push({
        name: pages > 1 ? `${name} (${p})` : name,
        width: turned ? h : w,
        height: turned ? w : h,
        thumbnail: toDataUrl(canvas, crop),
        note:
          doc.numPages > MAX_PAGES && p === pages
            ? `Dosyada ${doc.numPages} sayfa var; ilk ${MAX_PAGES} sayfa alındı.`
            : fromArt
              ? 'Çizim sayfadan küçük: ölçü sayfa yerine çizimin sınırlarından alındı. Kesim payı/taşma dahil olabilir, ölçüyü kontrol edin.'
              : null,
      });
    }
    return out;
  } finally {
    void task.destroy();
  }
}

function readPostScript(bytes: Uint8Array, name: string, isAi: boolean): ImportedArtwork {
  const ps = postScriptPart(bytes);
  const header = new TextDecoder('latin1').decode(ps.subarray(0, 64 * 1024));
  const box = postScriptBox(header);
  if (!box) throw new Error(`${name}: dosyada ölçü bilgisi (BoundingBox) bulunamadı.`);
  return {
    name,
    width: ptToMm(box[2] - box[0]),
    height: ptToMm(box[3] - box[1]),
    thumbnail: null,
    // BoundingBox is the extent of the drawing itself, not the artboard; a missing bleed or margin changes it.
    note: isAi
      ? 'Illustrator dosyası PDF uyumlu kaydedilmemiş: ölçü çizimin sınırlarından alındı, önizleme yok. Ölçüyü kontrol edin.'
      : 'Ölçü çizimin sınırlarından (BoundingBox) alındı, önizleme yok. Ölçüyü kontrol edin.',
  };
}

async function readSvg(text: string, name: string): Promise<ImportedArtwork> {
  const size = svgSize(text);
  if (!size) throw new Error(`${name}: SVG dosyasında ölçü (width/height veya viewBox) bulunamadı.`);
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = THUMB_PX / Math.max(size.width, size.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(size.width * scale));
    canvas.height = Math.max(1, Math.round(size.height * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { name, ...size, thumbnail: toDataUrl(canvas, null), note: null };
  } catch {
    return { name, ...size, thumbnail: null, note: 'SVG önizlemesi çizilemedi; ölçü alındı.' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toDataUrl(canvas: HTMLCanvasElement, crop: { x: number; y: number; w: number; h: number } | null): string {
  let out = canvas;
  if (crop && crop.w >= 1 && crop.h >= 1) {
    out = document.createElement('canvas');
    out.width = Math.round(crop.w);
    out.height = Math.round(crop.h);
    out.getContext('2d')!.drawImage(canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
  }
  // Browsers without WebP encoding return PNG instead, which the server accepts too.
  return out.toDataURL('image/webp', 0.82);
}
