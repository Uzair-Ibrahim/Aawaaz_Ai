import { createSupabaseContext, fromSupabaseUrl, type SupabaseContext } from '@supabase/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import {
  getEffectiveSupabasePublishableKey,
  getEffectiveSupabaseSecretKey,
  type AppEnv,
} from '../../config/env';

export interface SupabaseRuntimeHealthSnapshot {
  storage: 'supabase' | 'memory';
  database: 'connected' | 'supabase_api_connected' | 'fallback_memory';
  supabase_project_url: string;
  jwks_reachable: boolean;
  auth_health_status: number | null;
  postgres_connected: boolean;
  postgres_error: string | null;
  has_unmasked_secret_key: boolean;
  warnings: string[];
  last_checked_at: string | null;
}

/**
 * Integrates @supabase/server, @supabase/supabase-js, and pg cleanly with
 * Smart Resilience Guard:
 *  - Verifies live Supabase Auth / JWKS reachability via @supabase/server config.
 *  - Connects to live Postgres via DATABASE_URL / SUPABASE_POOLER_URL when reachable.
 *  - Uses Admin Supabase Client when an unmasked SUPABASE_SECRET_KEY is supplied.
 *  - Never crashes server boot if SUPABASE_SECRET_KEY is masked or direct IPv6 DB is blocked;
 *    falls back cleanly and emits explicit startup diagnostics.
 */
export class SupabaseServerRuntime {
  private readonly env: AppEnv;
  private readonly publicClient: SupabaseClient | null;
  private readonly adminClient: SupabaseClient | null;
  private pool: Pool | null = null;
  private snapshot: SupabaseRuntimeHealthSnapshot;

  constructor(env: AppEnv) {
    this.env = env;
    const url = env.SUPABASE_URL.trim();
    const publishableKey = getEffectiveSupabasePublishableKey(env);
    const secretKey = getEffectiveSupabaseSecretKey(env);

    this.publicClient =
      url && publishableKey
        ? createClient(url, publishableKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null;

    this.adminClient =
      url && secretKey
        ? createClient(url, secretKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          })
        : null;

    const initialWarnings: string[] = [];
    if (url && !secretKey) {
      initialWarnings.push(
        'SUPABASE_SECRET_KEY is masked/placeholder in backend/.env — paste the unmasked Supabase secret key (sb_secret_... or service_role JWT) to enable full Supabase Admin API writes.',
      );
    }

    this.snapshot = {
      storage: env.DATA_STORE_MODE === 'supabase' ? 'supabase' : 'memory',
      database: env.DATA_STORE_MODE === 'supabase' ? 'supabase_api_connected' : 'fallback_memory',
      supabase_project_url: url,
      jwks_reachable: false,
      auth_health_status: null,
      postgres_connected: false,
      postgres_error: null,
      has_unmasked_secret_key: Boolean(secretKey),
      warnings: initialWarnings,
      last_checked_at: null,
    };
  }

  getPublicClient(): SupabaseClient | null {
    return this.publicClient;
  }

  getAdminClient(): SupabaseClient | null {
    return this.adminClient;
  }

  getPool(): Pool | null {
    return this.pool;
  }

  getHealthSnapshot(): SupabaseRuntimeHealthSnapshot {
    return { ...this.snapshot, warnings: [...this.snapshot.warnings] };
  }

  /**
   * Uses @supabase/server's `createSupabaseContext` + `fromSupabaseUrl` to verify
   * an incoming Bearer JWT against the live Supabase JWKS endpoint.
   */
  async verifyBearerTokenWithSupabaseServer(authorizationHeader?: string): Promise<{
    verified: boolean;
    context?: SupabaseContext;
    errorMessage?: string;
  }> {
    const url = this.env.SUPABASE_URL.trim();
    const publishableKey = getEffectiveSupabasePublishableKey(this.env);
    const secretKey = getEffectiveSupabaseSecretKey(this.env);
    if (!url || !publishableKey || !authorizationHeader) {
      return { verified: false, errorMessage: 'Supabase URL, publishable key, or Authorization header missing.' };
    }

    const req = new Request(url, {
      headers: {
        Authorization: authorizationHeader,
      },
    });

    const issuer = fromSupabaseUrl(url);
    const jwksUrl = this.env.SUPABASE_JWKS_URL.trim() || `${issuer}/.well-known/jwks.json`;

    const result = await createSupabaseContext(req, {
      auth: 'user',
      env: {
        url,
        publishableKeys: { default: publishableKey },
        secretKeys: secretKey ? { default: secretKey } : {},
        jwks: new URL(jwksUrl),
      },
    });

    if (result.error) {
      return { verified: false, errorMessage: result.error.message };
    }
    return { verified: true, context: result.data };
  }

  /**
   * Probes live Supabase JWKS/Auth HTTPS reachability and optional Postgres connectivity.
   * Safe to invoke asynchronously at server startup (never throws).
   */
  async probeLiveConnectivity(): Promise<SupabaseRuntimeHealthSnapshot> {
    const url = this.env.SUPABASE_URL.trim();
    const publishableKey = getEffectiveSupabasePublishableKey(this.env);
    const secretKey = getEffectiveSupabaseSecretKey(this.env);
    const warnings: string[] = [];

    if (url && !secretKey) {
      warnings.push(
        'SUPABASE_SECRET_KEY in backend/.env is still a placeholder. Paste your unmasked secret key to activate Supabase Admin API mode.',
      );
    }

    let jwksReachable = false;
    let authHealthStatus: number | null = null;

    if (url) {
      const jwksUrl =
        this.env.SUPABASE_JWKS_URL.trim() || `${url.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4500);
        const [jwksRes, authHealthRes] = await Promise.all([
          fetch(jwksUrl, { signal: controller.signal }),
          publishableKey
            ? fetch(`${url.replace(/\/$/, '')}/auth/v1/health`, {
                headers: { apikey: publishableKey },
                signal: controller.signal,
              })
            : Promise.resolve(null),
        ]);
        clearTimeout(timer);
        jwksReachable = jwksRes.ok;
        authHealthStatus = authHealthRes ? authHealthRes.status : null;
      } catch (err) {
        warnings.push(`Supabase HTTPS probe unreachable: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    let postgresConnected = false;
    let postgresError: string | null = null;
    const pgUrl = (this.env.SUPABASE_POOLER_URL || this.env.DATABASE_URL || '').trim();

    if (pgUrl) {
      try {
        const candidatePool = new Pool({
          connectionString: pgUrl,
          ssl: { rejectUnauthorized: false },
          max: 5,
          connectionTimeoutMillis: 4500,
          idleTimeoutMillis: 15000,
        });
        const client = await candidatePool.connect();
        await client.query('SELECT 1');
        client.release();
        if (this.pool) {
          await this.pool.end().catch(() => {});
        }
        this.pool = candidatePool;
        postgresConnected = true;
      } catch (err) {
        const errCode = (err as { code?: string })?.code ?? '';
        const errMsg = err instanceof Error ? err.message : String(err);
        postgresError = errCode ? `${errCode}: ${errMsg}` : errMsg;
        warnings.push(
          `Direct PostgreSQL connection (${pgUrl.replace(/:[^:@]+@/, ':***@')}) did not connect (${postgresError}). If on an IPv4-only network, set SUPABASE_POOLER_URL to your Supabase Session Pooler URI with your verified DB password in backend/.env.`,
        );
      }
    }

    const storage: 'supabase' | 'memory' =
      postgresConnected || (this.env.DATA_STORE_MODE === 'supabase' && Boolean(secretKey))
        ? 'supabase'
        : 'memory';

    const database: 'connected' | 'supabase_api_connected' | 'fallback_memory' = postgresConnected
      ? 'connected'
      : jwksReachable && Boolean(secretKey)
        ? 'supabase_api_connected'
        : 'fallback_memory';

    this.snapshot = {
      storage,
      database,
      supabase_project_url: url,
      jwks_reachable: jwksReachable,
      auth_health_status: authHealthStatus,
      postgres_connected: postgresConnected,
      postgres_error: postgresError,
      has_unmasked_secret_key: Boolean(secretKey),
      warnings,
      last_checked_at: new Date().toISOString(),
    };

    return this.getHealthSnapshot();
  }
}
