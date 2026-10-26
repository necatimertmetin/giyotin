import type { Db } from './schema';
import { createStock, listStock, saveOrder } from './services';

/** Realistic sample data so the application is usable right after the first start. */
export function seedIfEmpty(db: Db): void {
  if (listStock(db).length > 0) return;
  const kuse135 = { name: 'Kuşe', gsm: 135, finish: 'Parlak', color: 'Beyaz' };
  const kuse350 = { name: 'Kuşe', gsm: 350, finish: 'Mat', color: 'Beyaz' };
  const base = { kind: 'sheet', formatName: null, notes: null, allowRotation: true, grain: 'none', status: 'active' } as const;
  createStock(db, { ...base, ...kuse135, formatName: '70×100', width: 700, height: 1000, quantity: 40, unitCost: 8.5 });
  createStock(db, { ...base, ...kuse135, formatName: 'A2', width: 420, height: 594, quantity: 30, unitCost: 2.9 });
  createStock(db, { ...base, ...kuse350, formatName: '70×100', width: 700, height: 1000, quantity: 25, unitCost: 22 });
  createStock(db, { ...base, name: 'Ofset', gsm: 80, finish: null, color: 'Beyaz', formatName: '64×90', width: 640, height: 900, quantity: 60, unitCost: 3.1 });
  createStock(db, { ...base, ...kuse135, kind: 'offcut', width: 300, height: 420, quantity: 2, unitCost: null, notes: 'Önceki işten artan parça' });

  const key = (n: string, g: number, c: string, f: string | null): string => [n, g, c, f ?? ''].map((v) => String(v).toLocaleLowerCase('tr-TR')).join('|');
  saveOrder(db, {
    name: 'Örnek sipariş — Açılış kampanyası',
    notes: 'Örnek veri: dilediğiniz gibi değiştirebilirsiniz.',
    lines: [
      { name: 'Flyer', width: 100, height: 150, quantity: 500, notes: null, allowRotation: true, materialKey: key('Kuşe', 135, 'Beyaz', 'Parlak'), grain: 'any', minWidth: null, minHeight: null },
      { name: 'Poster', width: 300, height: 400, quantity: 25, notes: null, allowRotation: true, materialKey: key('Kuşe', 135, 'Beyaz', 'Parlak'), grain: 'any', minWidth: null, minHeight: null },
      { name: 'Davetiye', width: 148, height: 210, quantity: 120, notes: null, allowRotation: true, materialKey: key('Kuşe', 350, 'Beyaz', 'Mat'), grain: 'any', minWidth: null, minHeight: null },
      { name: 'Kartvizit', width: 85, height: 55, quantity: 1000, notes: 'Mat selofan', allowRotation: true, materialKey: key('Kuşe', 350, 'Beyaz', 'Mat'), grain: 'any', minWidth: null, minHeight: null },
    ],
  });

  // Single paper type, four different sizes.
  const kuse135Key = key('Kuşe', 135, 'Beyaz', 'Parlak');
  const sizes: Array<[string, number, number, number]> = [
    ['Katalog sayfası', 210, 297, 150],
    ['Broşür', 148, 210, 400],
    ['Zarf kartı', 100, 210, 300],
    ['Etiket', 60, 90, 800],
  ];
  saveOrder(db, {
    name: 'Örnek sipariş — Broşür seti (tek kağıt)',
    notes: 'Örnek veri: hepsi Kuşe 135 gr, 4 farklı boyut.',
    lines: sizes.map(([name, width, height, quantity]) => ({ name, width, height, quantity, notes: null, allowRotation: true, materialKey: kuse135Key, grain: 'any' as const, minWidth: null, minHeight: null })),
  });
}
