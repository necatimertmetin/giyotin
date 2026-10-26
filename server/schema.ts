/**
 * Database schema and the tiny database interface the services need. It is implemented by `node:sqlite`
 * (server) and by an adapter over sql.js (browser-only build), so this file must stay free of Node imports.
 */
export interface Statement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface Db {
  prepare(sql: string): Statement;
  exec(sql: string): void;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS custom_papers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('sheet','offcut')),
  name TEXT NOT NULL,
  format_name TEXT,
  width REAL NOT NULL CHECK (width > 0),
  height REAL NOT NULL CHECK (height > 0),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  unit_cost REAL,
  gsm REAL,
  color TEXT,
  finish TEXT,
  notes TEXT,
  allow_rotation INTEGER NOT NULL DEFAULT 1,
  grain TEXT NOT NULL DEFAULT 'none',
  material_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','excluded')),
  source_job_id INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','completed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  quantity INTEGER NOT NULL,
  notes TEXT,
  allow_rotation INTEGER NOT NULL DEFAULT 1,
  material_key TEXT,
  grain TEXT NOT NULL DEFAULT 'any',
  min_width REAL,
  min_height REAL
);

CREATE TABLE IF NOT EXISTS setting_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  settings TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- An optimisation preview. Never touches stock; kept so a plan can be inspected and later confirmed.
CREATE TABLE IF NOT EXISTS optimization_runs (
  id TEXT PRIMARY KEY,
  order_id INTEGER,
  order_name TEXT NOT NULL,
  settings TEXT NOT NULL,
  input TEXT NOT NULL,
  stock_versions TEXT NOT NULL,
  result TEXT NOT NULL,
  confirmed_job_id INTEGER,
  created_at TEXT NOT NULL
);

-- A confirmed job. Holds a complete snapshot (input + plan) so history survives later stock edits.
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL UNIQUE,
  order_id INTEGER,
  order_name TEXT NOT NULL,
  settings TEXT NOT NULL,
  input TEXT NOT NULL,
  plan TEXT NOT NULL,
  sheet_count INTEGER NOT NULL,
  utilization REAL NOT NULL,
  piece_area REAL NOT NULL,
  stock_area REAL NOT NULL,
  waste_area REAL NOT NULL,
  offcut_area REAL NOT NULL,
  cuts INTEGER NOT NULL,
  cost REAL,
  fulfilled INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_consumption (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  stock_item_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS job_offcuts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id),
  sheet_index INTEGER NOT NULL,
  leaf_index INTEGER NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  quantity INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','added','discarded')),
  stock_item_id INTEGER,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_kind ON stock_items(kind, deleted_at);
CREATE INDEX IF NOT EXISTS idx_lines_order ON order_lines(order_id);
`;

/** Run `fn` inside a transaction; any thrown error rolls everything back. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export const nowIso = (): string => new Date().toISOString();
