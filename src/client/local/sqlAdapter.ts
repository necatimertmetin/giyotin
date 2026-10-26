import type { Database, SqlValue } from 'sql.js';
import type { Db, Statement } from '../../../server/schema';

const toSql = (params: unknown[]): SqlValue[] =>
  params.map((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'bigint') return Number(v);
    return v as SqlValue;
  });

/**
 * Makes an sql.js database look like the `node:sqlite` subset the services use (`prepare().run/get/all`, `exec`).
 * Statements are prepared and freed per call, so `Database.export()` (which reopens the database) is always safe.
 */
export function adaptSqlJs(raw: Database): Db {
  const statement = (sql: string): Statement => ({
    run(...params) {
      raw.run(sql, toSql(params));
      const changes = raw.getRowsModified();
      const id = raw.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0];
      return { changes, lastInsertRowid: Number(id ?? 0) };
    },
    get(...params) {
      const st = raw.prepare(sql);
      try {
        st.bind(toSql(params));
        return st.step() ? st.getAsObject() : undefined;
      } finally {
        st.free();
      }
    },
    all(...params) {
      const st = raw.prepare(sql);
      try {
        st.bind(toSql(params));
        const out: unknown[] = [];
        while (st.step()) out.push(st.getAsObject());
        return out;
      } finally {
        st.free();
      }
    },
  });
  return {
    prepare: statement,
    exec(sql) {
      raw.exec(sql);
    },
  };
}
