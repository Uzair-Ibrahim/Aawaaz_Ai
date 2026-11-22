import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function connectWithPoolerFallback(): Promise<{ client: Client; endpoint: string }> {
  const candidates: Array<{ label: string; connectionString: string }> = [];
  if (process.env.SUPABASE_POOLER_URL?.trim()) {
    candidates.push({ label: 'SUPABASE_POOLER_URL', connectionString: process.env.SUPABASE_POOLER_URL.trim() });
  }
  if (process.env.DATABASE_URL?.trim()) {
    const raw = process.env.DATABASE_URL.trim();
    candidates.push({ label: 'DATABASE_URL', connectionString: raw });
    // Also synthesize IPv4 Supavisor Session Pooler URI for Supabase project refs when direct db.* host is IPv6-only
    const match = raw.match(/^postgresql:\/\/([^:]+):([^@]+)@db\.([a-z0-9]+)\.supabase\.co:5432\/(.+)$/i);
    if (match) {
      const [, user, pass, projectRef, dbName] = match;
      candidates.push({
        label: 'Supavisor IPv4 Session Pooler (ap-northeast-2)',
        connectionString: `postgresql://${user}.${projectRef}:${pass}@aws-1-ap-northeast-2.pooler.supabase.com:5432/${dbName}`,
      });
    }
  }

  if (candidates.length === 0) {
    throw new Error('DATABASE_URL is not configured in backend/.env.');
  }

  const errors: string[] = [];
  for (const cand of candidates) {
    const client = new Client({
      connectionString: cand.connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 6000,
    });
    try {
      await client.connect();
      return { client, endpoint: cand.label };
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${cand.label}: ${code ? `${code} ` : ''}${msg}`);
      await client.end().catch(() => {});
    }
  }

  throw new Error(`Could not connect to Supabase PostgreSQL:\n  - ${errors.join('\n  - ')}`);
}

async function main() {
  console.log('[db:migrate] Connecting to Supabase PostgreSQL...');
  const { client, endpoint } = await connectWithPoolerFallback();
  console.log(`[db:migrate] Connected via ${endpoint}.`);

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.awaaz_schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const migrationsDir = path.resolve(__dirname, '../../supabase/migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let appliedCount = 0;
    let skippedCount = 0;

    for (const file of files) {
      const exists = await client.query(
        'SELECT 1 FROM public.awaaz_schema_migrations WHERE filename = $1',
        [file],
      );
      if (exists.rowCount && exists.rowCount > 0) {
        skippedCount += 1;
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`[db:migrate] Applying ${file}...`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO public.awaaz_schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
          [file],
        );
        await client.query('COMMIT');
        appliedCount += 1;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        const msg = err instanceof Error ? err.message : String(err);
        if (/already exists/i.test(msg)) {
          console.warn(`[db:migrate] Notice in ${file} (object already exists, marking applied): ${msg}`);
          await client.query(
            'INSERT INTO public.awaaz_schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
            [file],
          );
          skippedCount += 1;
        } else {
          throw new Error(`Migration ${file} failed: ${msg}`);
        }
      }
    }

    console.log(`[db:migrate] Complete. Applied: ${appliedCount}, Already present: ${skippedCount}, Total: ${files.length}.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[db:migrate] ERROR:', err instanceof Error ? err.message : String(err));
  console.error(
    '[db:migrate] TIP: Verify your Supabase Database password and copy the Session Pooler URI (IPv4) into SUPABASE_POOLER_URL or DATABASE_URL in backend/.env.',
  );
  process.exit(1);
});
