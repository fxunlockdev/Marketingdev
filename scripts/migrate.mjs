import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Pool } from 'pg';

export async function migrate(pool) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(`SELECT pg_advisory_xact_lock(724106230)`);
    await db.query(`CREATE SCHEMA IF NOT EXISTS desvio_migrations;
      REVOKE ALL ON SCHEMA desvio_migrations FROM PUBLIC;
      CREATE TABLE IF NOT EXISTS desvio_migrations.applied(name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const directory = new URL('../database/migrations/', import.meta.url);
    for (const name of (await readdir(directory)).filter(n => /^\d+_.+\.sql$/.test(n)).sort()) {
      const sql = await readFile(new URL(name, directory), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      const { rows: [prior] } = await db.query('SELECT sha256 FROM desvio_migrations.applied WHERE name=$1', [name]);
      if (prior) {
        if (prior.sha256 !== hash) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await db.query(sql);
      await db.query('INSERT INTO desvio_migrations.applied(name,sha256) VALUES ($1,$2)', [name,hash]);
    }
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL is required; never use it in the runtime');
  const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  try { await migrate(pool); console.log('Migrations applied with checksum verification'); }
  finally { await pool.end(); }
}
