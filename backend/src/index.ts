import { createApp } from './app';
import { getIntegrationStatus } from './config/env';

const { app, env, supabaseRuntime } = createApp();
const status = getIntegrationStatus(env);

const HOST = process.env.HOST || '0.0.0.0';

app.listen(env.PORT, HOST, () => {
  console.log(`[awaaz-backend] Listening on http://${HOST}:${env.PORT}/api/v1`);
  console.log(`[awaaz-backend] OpenAPI docs: http://${HOST}:${env.PORT}/api/v1/docs`);
  console.log(
    `[awaaz-backend] Mode: env=${env.NODE_ENV}, dataStore=${status.dataStoreMode}, auth=${status.authMode}, aiConfigured=${status.ai.configured}, voice=${status.voice.provider}(configured=${status.voice.configured})`,
  );

  // Smart Resilience Guard: asynchronously probe live Supabase JWKS/Auth & PostgreSQL without blocking startup
  void supabaseRuntime
    .probeLiveConnectivity()
    .then((sb) => {
      console.log(
        `[awaaz-backend] Supabase Runtime: project=${sb.supabase_project_url || 'unset'}, jwksReachable=${sb.jwks_reachable}, authHealth=${sb.auth_health_status ?? 'n/a'}, postgresConnected=${sb.postgres_connected}, storage=${sb.storage}, database=${sb.database}`,
      );
      for (const warning of sb.warnings) {
        console.warn(`[awaaz-backend] [SUPABASE NOTICE] ${warning}`);
      }
    })
    .catch((err) => {
      console.warn(
        `[awaaz-backend] [SUPABASE NOTICE] Non-fatal connectivity probe error: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
});
