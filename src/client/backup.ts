import type { BackupDto, ImportSummary } from '../shared/api';
import { api } from './api';
import { allArtworkSources, saveArtworkSource } from './import/artworkSources';

/** The database, plus the vector originals of the products, which live in this browser and not in the database. */
export interface BackupFile extends BackupDto {
  artworkSources?: Array<{ id: string; pdf: string; box: [number, number, number, number] }>;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // In pieces: fromCharCode cannot take a whole PDF as arguments.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export async function makeBackup(): Promise<{ blob: Blob; fileName: string }> {
  const sources = await allArtworkSources();
  const file: BackupFile = {
    ...(await api.admin.exportAll()),
    artworkSources: sources.map(([id, s]) => ({ id, pdf: toBase64(s.pdf), box: s.box })),
  };
  return {
    blob: new Blob([JSON.stringify(file)], { type: 'application/json' }),
    fileName: `giyotin-yedek-${new Date().toISOString().slice(0, 10)}.json`,
  };
}

export async function readBackup(file: File): Promise<BackupFile> {
  try {
    const parsed = JSON.parse(await file.text()) as BackupFile;
    if (parsed.app === 'giyotin' && parsed.tables) return parsed;
  } catch {
    // Reported below, same as a JSON file of something else.
  }
  throw new Error(`${file.name} bir Giyotin yedeği değil.`);
}

export async function restoreBackup(backup: BackupFile): Promise<ImportSummary> {
  const { artworkSources = [], ...data } = backup;
  const summary = await api.admin.importAll(data);
  for (const s of artworkSources) await saveArtworkSource(s.id, { pdf: fromBase64(s.pdf), box: s.box });
  return summary;
}
