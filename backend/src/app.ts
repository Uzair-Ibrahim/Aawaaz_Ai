import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import yaml from 'js-yaml';
import swaggerUi from 'swagger-ui-express';
import { loadEnv, type AppEnv } from './config/env';
import { AuditService } from './core/audit/audit-service';
import { AuthService } from './core/auth/auth-service';
import { createAuthMiddleware } from './core/auth/middleware';
import { MemoryDataStore } from './core/database/memory-store';
import { SupabaseServerRuntime } from './core/database/supabase-server-client';
import { SupabaseDataStore } from './core/database/supabase-store';
import type { DataStore } from './core/database/types';
import { ModuleRegistry } from './core/modules/registry';
import { NotificationService } from './core/notifications/notification-service';
import { createSaasRouter } from './core/routes/saas-routes';
import { errorHandler } from './core/security/errors';
import { createPrivateStorage, type PrivateStorageAdapter } from './core/storage/storage';
import { GeminiAIProvider } from './integrations/ai/gemini';
import type { AIProvider } from './integrations/ai/provider';
import { createVoiceProvider } from './integrations/voice';
import type { VoiceProvider } from './integrations/voice/provider';
import { createReliefAssistanceModule } from './modules/relief-assistance/module';

export interface AppDependencies {
  env?: AppEnv;
  store?: DataStore;
  storage?: PrivateStorageAdapter;
  aiProvider?: AIProvider;
  voiceProvider?: VoiceProvider;
}

export function createApp(overrides: AppDependencies = {}): {
  app: Express;
  env: AppEnv;
  store: DataStore;
  moduleRegistry: ModuleRegistry;
  supabaseRuntime: SupabaseServerRuntime;
} {
  const env = overrides.env ?? loadEnv();
  const supabaseRuntime = new SupabaseServerRuntime(env);
  const store: DataStore =
    overrides.store ??
    (env.DATA_STORE_MODE === 'supabase'
      ? new SupabaseDataStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
      : new MemoryDataStore(true));

  const storage = overrides.storage ?? createPrivateStorage(env);
  const aiProvider = overrides.aiProvider ?? new GeminiAIProvider(env);
  const voiceProvider = overrides.voiceProvider ?? createVoiceProvider(env);
  const audit = new AuditService(store);
  const notifications = new NotificationService(store);
  const authService = new AuthService(env, store);
  const requireAuth = createAuthMiddleware(authService);
  const moduleRegistry = new ModuleRegistry();

  // Register Idea 1: Relief Assistance Module
  // Future Ideas 2 & 3 plug in right here via moduleRegistry.register(...)
  moduleRegistry.register(
    createReliefAssistanceModule({
      env,
      store,
      storage,
      aiProvider,
      voiceProvider,
      audit,
      notifications,
      authService,
      requireAuth,
    }),
  );

  const app = express();
  app.set('trust proxy', 1);

  const normalizeOrigin = (value: string): string => value.trim().replace(/\/+$/, '');
  const allowedOrigins = new Set<string>(
    [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      env.APP_URL,
      env.FRONTEND_URL,
      ...env.CORS_ORIGIN.split(','),
      ...env.ALLOWED_ORIGINS.split(','),
    ]
      .map(normalizeOrigin)
      .filter(Boolean),
  );
  const isVercelOrigin = (origin: string): boolean =>
    /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/i.test(origin);
  const isAllowedOrigin = (origin: string | undefined): boolean => {
    if (!origin) return true;
    const normalized = normalizeOrigin(origin);
    return allowedOrigins.has(normalized) || isVercelOrigin(normalized);
  };

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => {
        if (isAllowedOrigin(origin)) {
          cb(null, true);
        } else {
          cb(null, false);
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Organization-Id', 'x-tenant-id', 'X-Requested-With'],
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Fast unthrottled root health check for Render / cloud load balancers
  app.get('/health', (_req, res) => {
    const sbHealth = supabaseRuntime.getHealthSnapshot();
    res.status(200).json({
      status: 'ok',
      service: 'awaaz-backend',
      storage: sbHealth.storage,
      database: sbHealth.database,
    });
  });

  // Basic origin check for state-changing cookie-authenticated requests (CSRF defense-in-depth)
  app.use('/api/v1', (req, res, next) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && !req.headers.authorization) {
      const origin = req.headers.origin;
      if (origin && !isAllowedOrigin(origin)) {
        res.status(403).json({
          error: {
            code: 'CSRF_ORIGIN_MISMATCH',
            message: 'Request origin is not permitted.',
          },
        });
        return;
      }
    }
    next();
  });

  if (env.NODE_ENV !== 'test') {
    app.use(
      '/api/v1',
      rateLimit({
        windowMs: env.RATE_LIMIT_WINDOW_MS,
        max: env.RATE_LIMIT_MAX_REQUESTS,
        standardHeaders: true,
        legacyHeaders: false,
      }),
    );
  }

  // OpenAPI / Swagger UI (§3 & §18)
  const openApiCandidates = [
    path.resolve(__dirname, '../../docs/OPENAPI.yaml'),
    path.resolve(process.cwd(), '../docs/OPENAPI.yaml'),
    path.resolve(process.cwd(), 'docs/OPENAPI.yaml'),
  ];
  const openApiPath = openApiCandidates.find((p) => fs.existsSync(p));
  if (openApiPath) {
    try {
      const spec = yaml.load(fs.readFileSync(openApiPath, 'utf8')) as Record<string, unknown>;
      app.use('/api/v1/docs', swaggerUi.serve, swaggerUi.setup(spec));
      app.get('/api/v1/openapi.json', (_req, res) => res.json(spec));
    } catch {
      // Non-fatal if spec file is not readable
    }
  }

  // Mount Shared SaaS Core Routes
  app.use(
    '/api/v1',
    createSaasRouter({
      env,
      store,
      authService,
      requireAuth,
      audit,
      notifications,
      moduleRegistry,
      supabaseRuntime,
    }),
  );

  // Mount Registered Feature Modules
  for (const mod of moduleRegistry.getAll()) {
    const modRouter = mod.createRouter();
    app.use(mod.manifest.apiBasePath, modRouter);
    // Also expose top-level /mcp convenience mount for external MCP clients
    if (mod.manifest.id === 'relief-assistance') {
      app.use('/', modRouter);
    }
  }

  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'API endpoint not found.',
      },
    });
  });

  app.use(errorHandler);

  return { app, env, store, moduleRegistry, supabaseRuntime };
}
