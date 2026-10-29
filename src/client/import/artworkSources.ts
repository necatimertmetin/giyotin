import type { Box } from './artworkFormat';

/**
 * The vector original of an imported product: its PDF page as a one-page PDF, and the part of that page that is the
 * finished piece (PDF points). Used to print the layout sharp; the database keeps only the small preview image.
 *
 * Sources can be tens of MB (spark.pdf: 27 MB of vector paths), so they live in their own IndexedDB store in this
 * browser rather than in the database, which the browser-only build rewrites as a whole on every change.
 */
export interface ArtworkSource {
  pdf: Uint8Array;
  box: Box;
}

const DB = 'giyotin-artwork-sources';
const STORE = 'sources';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const saveArtworkSource = (artworkId: string, source: ArtworkSource): Promise<void> => run<undefined>('readwrite', (s) => s.put(source, artworkId)).then(() => undefined);

/** The stored source, or null when there is none (imported elsewhere or before sources were kept) or storage fails. */
export const getArtworkSource = (artworkId: string): Promise<ArtworkSource | null> =>
  run<ArtworkSource | undefined>('readonly', (s) => s.get(artworkId)).then((v) => v ?? null, () => null);
