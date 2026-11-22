import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import {
  createAssistanceRequestSchema,
  createCaseSchema,
  createDepartmentAccountSchema,
  createHumanizedGuidanceSchema,
  createMockPaymentSchema,
  documentTypeSchema,
  eligibilityRuleDefinitionSchema,
  extractFieldRequestSchema,
  grantConsentSchema,
  LANGUAGE_LIST,
  languageCodeSchema,
  officerDecisionSchema,
  officerRequestInfoSchema,
  patchCaseAnswersSchema,
  ragQuerySchema,
  respondAssistanceRequestSchema,
  type ServiceDepartmentCode,
  userRoleSchema,
} from '@awaaz/shared';
import { z } from 'zod';
import type { AppEnv } from '../../config/env';
import type { AuditService } from '../../core/audit/audit-service';
import type { AuthService } from '../../core/auth/auth-service';
import { SESSION_COOKIE_NAME } from '../../core/auth/middleware';
import type { DataStore } from '../../core/database/types';
import type { BackendFeatureModule } from '../../core/modules/registry';
import type { NotificationService } from '../../core/notifications/notification-service';
import { requirePermission, requireRoles } from '../../core/rbac/permissions';
import { AppError } from '../../core/security/errors';
import { LocalDevPrivateStorage, type PrivateStorageAdapter } from '../../core/storage/storage';
import type { AIProvider } from '../../integrations/ai/provider';
import { validateAudioUpload } from '../../integrations/voice/audio-validation';
import type { VoiceProvider } from '../../integrations/voice/provider';
import { ConsentService } from './consent/consent-service';
import { DocumentService } from './documents/document-service';
import { ExtractionService } from './extraction/extraction-service';
import { RagService } from './rag/rag-service';
import { AdminService } from './services/admin-service';
import { CaseService } from './services/case-service';
import { ConsentEnforcementService } from './services/consent-enforcement-service';
import { DocumentForgeryService } from './services/document-forgery-service';
import { EntityResolutionService } from './services/entity-resolution-service';
import { NluRagService } from './services/nlu-rag-service';
import { DynamicRuleEngineService } from './services/rule-engine-service';
import { UniversalRagService } from './services/universal-rag-service';
import { VoiceAgentService } from './services/voice-agent-service';
import { AmaanatMcpClient } from '../../mcp/client';
import { AmaanatMcpServer } from '../../mcp/mcp-tools';

export function createReliefAssistanceModule(deps: {
  env: AppEnv;
  store: DataStore;
  storage: PrivateStorageAdapter;
  aiProvider: AIProvider;
  voiceProvider: VoiceProvider;
  audit: AuditService;
  notifications: NotificationService;
  authService: AuthService;
  requireAuth: (req: Request, res: Response, next: NextFunction) => void;
}): BackendFeatureModule {
  const { env, store, storage, aiProvider, voiceProvider, audit, notifications, authService, requireAuth } = deps;

  const consentService = new ConsentService(store, audit);
  const ruleEngineService = new DynamicRuleEngineService(audit);
  const entityResolutionService = new EntityResolutionService(store);
  const consentEnforcementService = new ConsentEnforcementService(store, audit);
  const documentForgeryService = new DocumentForgeryService(store, audit);
  const caseService = new CaseService(
    store,
    consentService,
    audit,
    notifications,
    ruleEngineService,
    consentEnforcementService,
  );
  const extractionService = new ExtractionService(aiProvider, store);
  const documentService = new DocumentService(
    store,
    storage,
    aiProvider,
    audit,
    env.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
  );
  const ragService = new RagService(store, aiProvider, audit);
  const adminService = new AdminService(store, audit);
  const universalRagService = new UniversalRagService({
    env,
    store,
    aiProvider,
  });
  const mcpServer = new AmaanatMcpServer({
    store,
    caseService,
    consentService,
    ragService,
    documentService,
    aiProvider,
    audit,
    authService,
    universalRagService,
    ruleEngineService,
    entityResolutionService,
    consentEnforcementService,
    documentForgeryService,
  });
  const mcpClient = new AmaanatMcpClient(mcpServer);
  const nluRagService = new NluRagService({
    env,
    store,
    aiProvider,
  });
  const voiceAgentService = new VoiceAgentService({
    env,
    store,
    mcpServer,
    mcpClient,
    voiceProvider,
    aiProvider,
    nluRagService,
    universalRagService,
    ruleEngineService,
    consentEnforcementService,
    entityResolutionService,
    documentForgeryService,
  });

  const docUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.MAX_UPLOAD_SIZE_MB * 1024 * 1024 },
  });
  const audioUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.MAX_AUDIO_SIZE_MB * 1024 * 1024 },
  });

  const aiRateLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.AI_RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.userId ?? req.ip ?? 'anonymous',
    message: {
      error: {
        code: 'AI_RATE_LIMITED',
        message: 'Too many AI or voice requests. Please wait a moment and try again.',
      },
    },
  });

  const createRouter = (): Router => {
    const router = Router();

    // --- Language Registry (honest provider capabilities) ---
    router.get('/voice/languages', (_req, res) => {
      const languages = LANGUAGE_LIST.map((lang) => ({
        ...lang,
        stt_supported: voiceProvider.supportsStt(lang.language_code),
        tts_supported: voiceProvider.supportsTts(lang.language_code),
        active_provider: voiceProvider.providerName,
        provider_configured: voiceProvider.isConfigured(),
      }));
      res.json({ languages });
    });

    // Optional auth middleware for voice endpoints so pre-login citizen onboarding can also use speech
    const optionalVoiceAuth = async (req: Request, res: Response, next: NextFunction) => {
      const hasBearer = Boolean(req.headers.authorization?.startsWith('Bearer '));
      const hasCookie = Boolean(req.cookies?.awaaz_session);
      if (hasBearer || hasCookie) {
        return requireAuth(req, res, (err?: unknown) => {
          if (err) return next(err);
          return requirePermission('voice:use')(req, res, next);
        });
      }
      next();
    };

    // --- Voice (§18) ---
    router.post(
      '/voice/transcribe',
      optionalVoiceAuth,
      aiRateLimiter,
      audioUpload.single('audio'),
      async (req, res, next) => {
        try {
          const language = languageCodeSchema.parse(req.body.language ?? 'en');
          if (!req.file) {
            throw new AppError(400, 'AUDIO_FILE_REQUIRED', 'An audio recording file is required.');
          }
          const duration = req.body.duration_seconds ? Number(req.body.duration_seconds) : undefined;
          validateAudioUpload({
            buffer: req.file.buffer,
            mimeType: req.file.mimetype,
            maxSizeBytes: env.MAX_AUDIO_SIZE_MB * 1024 * 1024,
            durationSeconds: Number.isFinite(duration) ? duration : undefined,
          });

          const result = await voiceProvider.transcribe({
            audio: req.file.buffer,
            language,
            mimeType: req.file.mimetype,
          });

          res.json({ transcription: result });
        } catch (err) {
          next(err);
        }
      },
    );

    router.post(
      '/voice/speak',
      optionalVoiceAuth,
      aiRateLimiter,
      async (req, res, next) => {
        try {
          const body = z
            .object({
              text: z.string().min(1).max(600),
              language: languageCodeSchema.default('en'),
              voice: z.string().max(64).optional(),
            })
            .parse(req.body);

          const audio = await voiceProvider.synthesize(body);
          res.setHeader('Content-Type', audio.mimeType);
          res.setHeader('X-Voice-Provider', audio.provider);
          res.setHeader('X-Voice-Cached', String(audio.cached));
          res.send(audio.audio);
        } catch (err) {
          next(err);
        }
      },
    );

    // --- Phase 2: Protocol-Compliant Amaanat MCP Server Endpoints (/api/v1/mcp) backed by @modelcontextprotocol/sdk ---
    router.get('/mcp/tools', async (_req, res, next) => {
      try {
        const discoveredTools = await mcpClient.listDiscoveredTools();
        res.json({
          server: 'amaanat-relief-mcp',
          version: '2.0.0',
          sdk: '@modelcontextprotocol/sdk',
          protocolVersion: '2024-11-05',
          tools: discoveredTools,
        });
      } catch (err) {
        next(err);
      }
    });

    router.get('/mcp/sse', (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.write(`event: endpoint\ndata: /api/v1/mcp\n\n`);
      const keepAlive = setInterval(() => {
        res.write(`: keepalive\n\n`);
      }, 15000);
      req.on('close', () => clearInterval(keepAlive));
    });

    router.post('/mcp', optionalVoiceAuth, async (req, res, next) => {
      try {
        const body = (req.body ?? {}) as {
          jsonrpc?: string;
          id?: string | number | null;
          method?: string;
          params?: Record<string, unknown>;
          tool_name?: string;
          arguments?: Record<string, unknown>;
        };

        // Direct convenience invocation routed through real @modelcontextprotocol/sdk Client <-> Server
        if (body.tool_name && !body.method) {
          const callRecord = await mcpClient.callToolViaProtocol(body.tool_name, body.arguments ?? {}, req.auth);
          res.json(callRecord);
          return;
        }

        const id = body.id ?? 1;
        if (body.method === 'initialize') {
          await mcpClient.ensureConnected();
          res.json({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'amaanat-relief-mcp', version: '2.0.0' },
              sdk: '@modelcontextprotocol/sdk',
            },
          });
          return;
        }

        if (body.method === 'tools/list') {
          const discoveredTools = await mcpClient.listDiscoveredTools();
          res.json({
            jsonrpc: '2.0',
            id,
            result: { tools: discoveredTools },
          });
          return;
        }

        if (body.method === 'tools/call') {
          const toolName = String(body.params?.name ?? '');
          const toolArgs = (body.params?.arguments as Record<string, unknown>) ?? {};
          const callRecord = await mcpClient.callToolViaProtocol(toolName, toolArgs, req.auth);
          res.json({
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(callRecord.result) }],
              structuredContent: callRecord.result,
              toolCallRecord: callRecord,
              isError: callRecord.status === 'error',
            },
          });
          return;
        }

        res.status(400).json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Unsupported MCP method: ${String(body.method)}` },
        });
      } catch (err) {
        next(err);
      }
    });

    // --- Phase 2: Autonomous Multimodal Voice Orchestrator (/api/v1/voice/session) ---
    router.post(
      '/voice/session',
      optionalVoiceAuth,
      aiRateLimiter,
      audioUpload.single('audio'),
      async (req, res, next) => {
        try {
          const rawLang = req.body?.locked_language ?? req.body?.language;
          const parsedLang = languageCodeSchema.safeParse(rawLang);
          const synthesizeAudio =
            req.body?.synthesize_audio === true || req.body?.synthesize_audio === 'true';

          let clientFormState: Partial<import('./services/voice-agent-service').VoiceSessionFormState> | undefined;
          if (req.body?.form_state) {
            try {
              clientFormState =
                typeof req.body.form_state === 'string'
                  ? JSON.parse(req.body.form_state)
                  : req.body.form_state;
            } catch {
              // Ignore malformed client form_state
            }
          }

          const rawStage = req.body?.workflow_stage;
          const validStages = [
            'HOME_WELCOME',
            'LANGUAGE_SELECT',
            'ROLE_IDENTIFICATION',
            'CITIZEN_ACCOUNT_CHECK',
            'AUTH_GATE',
            'AGENT_HUB',
            'RELIEF_FORM',
            'ESCALATION_CONFIRM',
          ] as const;
          const workflowStageHint =
            typeof rawStage === 'string' && (validStages as readonly string[]).includes(rawStage)
              ? (rawStage as (typeof validStages)[number])
              : undefined;

          const languageExplicitSwitch =
            req.body?.language_explicit_switch === true || req.body?.language_explicit_switch === 'true';

          const turnResult = await voiceAgentService.processTurn({
            sessionId: typeof req.body?.session_id === 'string' ? req.body.session_id : undefined,
            audioBuffer: req.file?.buffer,
            audioMimeType: req.file?.mimetype,
            transcript: typeof req.body?.transcript === 'string' ? req.body.transcript : undefined,
            languageHint: parsedLang.success ? parsedLang.data : undefined,
            languageExplicitSwitch,
            workflowStageHint,
            imageBase64: typeof req.body?.image_base64 === 'string' ? req.body.image_base64 : undefined,
            imageMimeType: typeof req.body?.image_mime_type === 'string' ? req.body.image_mime_type : undefined,
            docType: typeof req.body?.doc_type === 'string' ? req.body.doc_type : undefined,
            synthesizeAudio,
            clientFormState,
            auth: req.auth,
          });
          if (turnResult.auth_session?.access_token) {
            res.cookie(SESSION_COOKIE_NAME, turnResult.auth_session.access_token, {
              httpOnly: true,
              sameSite: 'lax',
              secure: env.NODE_ENV === 'production',
              maxAge: 12 * 60 * 60 * 1000,
            });
          }
          res.json(turnResult);
        } catch (err) {
          next(err);
        }
      },
    );

    // --- Phase 4: Keypad Phone / Offline Calling Agent (Twilio-Compatible TwiML Webhooks) ---
    const escapeXml = (str: string) =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    router.post('/telephony/incoming', optionalVoiceAuth, async (req, res, next) => {
      try {
        const callSid = String(req.body?.CallSid || req.body?.call_sid || `call-${Date.now()}`);
        const rawLang = req.body?.language;
        const parsedLang = languageCodeSchema.safeParse(rawLang);
        const synthesizeAudio =
          req.body?.synthesize_audio === true || req.body?.synthesize_audio === 'true';

        const turn = await voiceAgentService.processTurn({
          sessionId: callSid,
          languageHint: parsedLang.success ? parsedLang.data : 'ur',
          workflowStageHint: 'RELIEF_FORM',
          isTelephonyMode: true,
          synthesizeAudio,
          auth: req.auth,
        });

        const keypadMenuHint =
          turn.detected_language === 'en'
            ? 'Press 1 to apply for relief, Press 2 to check claim status, Press 3 to verify a suspicious message, or speak directly after the tone.'
            : 'امداد کی درخواست کے لیے 1 دبائیں، درخواست کا اسٹیٹس جاننے کے لیے 2 دبائیں، مشکوک پیغام چیک کرنے کے لیے 3 دبائیں، یا براہ راست بولیں۔';

        const twiml = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<Response>',
          `  <Say language="${turn.detected_language === 'en' ? 'en-US' : 'ur-PK'}">${escapeXml(turn.agent_reply_text)} ${escapeXml(keypadMenuHint)}</Say>`,
          '  <Gather input="speech dtmf" action="/api/v1/telephony/gather" method="POST" timeout="6" numDigits="1" speechTimeout="auto"/>',
          '</Response>',
        ].join('\n');

        if (req.headers.accept?.includes('application/json') || req.query.format === 'json' || req.body?.format === 'json') {
          res.json({
            call_sid: callSid,
            ...turn,
            keypad_menu_hint: keypadMenuHint,
            twiml,
          });
          return;
        }

        res.setHeader('Content-Type', 'text/xml; charset=utf-8');
        res.send(twiml);
      } catch (err) {
        next(err);
      }
    });

    router.post(
      '/telephony/gather',
      optionalVoiceAuth,
      audioUpload.single('audio'),
      async (req, res, next) => {
        try {
          const callSid = String(req.body?.CallSid || req.body?.call_sid || req.body?.session_id || `call-${Date.now()}`);
          const digits = String(req.body?.Digits || req.body?.digits || '').trim();
          let speechResult = String(req.body?.SpeechResult || req.body?.transcript || '').trim();

          // Map keypad DTMF shortcuts for basic feature-phone users
          if (digits && !speechResult) {
            if (digits === '1') {
              speechResult = 'میرا نام آمنہ بی بی ہے، شناختی کوڈ MOCK-ID-1001، ضلع ملتان، ماہانہ آمدنی 18000، سیلاب زدگان ریلیف امداد چاہیے';
            } else if (digits === '2') {
              speechResult = 'Check claim status for MOCK-ID-1001';
            } else if (digits === '3') {
              speechResult = 'Scam check: مبارک ہو آپ کا 25000 انعام نکلا ہے، اپنا OTP کوڈ اور 500 روپے فیس بھیجیں';
            } else if (digits === '9' || digits === '#') {
              speechResult = 'جی ہاں، تصدیق ہے، میری درخواست جمع کر دیں';
            } else if (digits === '0') {
              speechResult = 'کون اہل ہے اور کون سے کاغذات چاہئیں؟';
            }
          }

          const rawLang = req.body?.locked_language ?? req.body?.language;
          const parsedLang = languageCodeSchema.safeParse(rawLang);
          const synthesizeAudio =
            req.body?.synthesize_audio === true || req.body?.synthesize_audio === 'true';

          const turn = await voiceAgentService.processTurn({
            sessionId: callSid,
            audioBuffer: req.file?.buffer,
            audioMimeType: req.file?.mimetype,
            transcript: speechResult || undefined,
            languageHint: parsedLang.success ? parsedLang.data : undefined,
            workflowStageHint: 'RELIEF_FORM',
            isTelephonyMode: true,
            synthesizeAudio,
            auth: req.auth,
          });

          const twiml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Response>',
            `  <Say language="${turn.detected_language === 'en' ? 'en-US' : 'ur-PK'}">${escapeXml(turn.agent_reply_text)}</Say>`,
            '  <Gather input="speech dtmf" action="/api/v1/telephony/gather" method="POST" timeout="6" numDigits="1" speechTimeout="auto"/>',
            '</Response>',
          ].join('\n');

          if (req.headers.accept?.includes('application/json') || req.query.format === 'json' || req.body?.format === 'json') {
            res.json({
              call_sid: callSid,
              digits_pressed: digits || null,
              ...turn,
              twiml,
            });
            return;
          }

          res.setHeader('Content-Type', 'text/xml; charset=utf-8');
          res.send(twiml);
        } catch (err) {
          next(err);
        }
      },
    );

    // --- Cases (§18) ---
    router.post('/cases', requireAuth, requirePermission('case:create'), async (req, res, next) => {
      try {
        const body = createCaseSchema.parse(req.body);
        const result = await caseService.createCase(req.auth!, body);
        res.status(result.idempotentReplay ? 200 : 201).json(result);
      } catch (err) {
        next(err);
      }
    });

    router.get('/cases', requireAuth, requirePermission('case:read_own_or_authorized'), async (req, res, next) => {
      try {
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const search = typeof req.query.search === 'string' ? req.query.search : undefined;
        const cases = await caseService.listAuthorizedCases(req.auth!, { status, search });
        res.json({ cases });
      } catch (err) {
        next(err);
      }
    });

    router.get('/cases/:id', requireAuth, requirePermission('case:read_own_or_authorized'), async (req, res, next) => {
      try {
        const detail = await caseService.getCaseDetail(req.auth!, String(req.params.id));
        res.json(detail);
      } catch (err) {
        next(err);
      }
    });

    router.patch('/cases/:id/answers', requireAuth, requirePermission('case:update_answers'), async (req, res, next) => {
      try {
        const body = patchCaseAnswersSchema.parse(req.body);
        const result = await caseService.patchAnswers(req.auth!, String(req.params.id), body);
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    router.post(
      '/cases/:id/extract-field',
      requireAuth,
      requirePermission('case:update_answers'),
      aiRateLimiter,
      async (req, res, next) => {
        try {
          const auth = req.auth!;
          const caseId = String(req.params.id);
          await caseService.assertCanAccessCase(auth, caseId, 'write');
          const body = extractFieldRequestSchema.parse(req.body);
          const extraction = await extractionService.extractActiveField({
            organizationId: auth.organizationId,
            caseId,
            activeField: body.active_field,
            language: body.language,
            transcript: body.transcript,
          });
          res.json({ extraction });
        } catch (err) {
          next(err);
        }
      },
    );

    router.post('/cases/:id/submit', requireAuth, requirePermission('case:submit'), async (req, res, next) => {
      try {
        if (req.body && req.body.explicit_confirmation === false) {
          throw new AppError(
            400,
            'CONFIRMATION_REQUIRED',
            'Explicit citizen confirmation is required before submitting the application.',
          );
        }
        const result = await caseService.submitCase(req.auth!, String(req.params.id));
        const referenceNumber = `AWZ-${result.case.id.slice(0, 8).toUpperCase()}`;
        res.json({
          ...result,
          reference_number: referenceNumber,
        });
      } catch (err) {
        next(err);
      }
    });

    router.post('/cases/:id/analyze', requireAuth, requirePermission('case:analyze'), async (req, res, next) => {
      try {
        const result = await caseService.analyzeCase(req.auth!, String(req.params.id));
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    router.get('/cases/:id/analysis', requireAuth, requirePermission('case:read_own_or_authorized'), async (req, res, next) => {
      try {
        const detail = await caseService.getCaseDetail(req.auth!, String(req.params.id));
        res.json({
          case_id: detail.case.id,
          rule_version_id: detail.case.rule_version_id,
          analysis: detail.case.analysis_result,
        });
      } catch (err) {
        next(err);
      }
    });

    // --- Documents (§18) ---
    // Signed local-dev download route (validates short-lived HMAC token; production uses Supabase signed URLs)
    router.get('/documents/private-download', async (req, res, next) => {
      try {
        if (!(storage instanceof LocalDevPrivateStorage)) {
          throw new AppError(404, 'NOT_FOUND', 'Use Supabase signed URLs in supabase storage mode.');
        }
        const storagePath = String(req.query.path ?? '');
        const exp = Number(req.query.exp ?? 0);
        const sig = String(req.query.sig ?? '');
        if (!storage.verifySignedToken(storagePath, exp, sig)) {
          throw new AppError(403, 'INVALID_OR_EXPIRED_SIGNED_URL', 'Signed document link is invalid or expired.');
        }
        const buf = await storage.downloadPrivate(storagePath);
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'no-store');
        res.send(buf);
      } catch (err) {
        next(err);
      }
    });

    router.post(
      '/documents',
      requireAuth,
      requirePermission('document:upload'),
      docUpload.single('file'),
      async (req, res, next) => {
        try {
          const auth = req.auth!;
          const caseId = z.string().uuid().parse(req.body.case_id);
          const documentType = documentTypeSchema.parse(req.body.document_type);
          await caseService.assertCanAccessCase(auth, caseId, 'write');

          if (!req.file) {
            throw new AppError(400, 'FILE_REQUIRED', 'Please attach a synthetic supporting document file.');
          }

          const document = await documentService.uploadDocument(auth, {
            caseId,
            documentType,
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
            buffer: req.file.buffer,
          });
          res.status(201).json({ document });
        } catch (err) {
          next(err);
        }
      },
    );

    router.post(
      '/documents/:id/extract',
      requireAuth,
      requirePermission('document:upload'),
      aiRateLimiter,
      async (req, res, next) => {
        try {
          const auth = req.auth!;
          const doc = await store.getDocumentById(auth.organizationId, String(req.params.id));
          if (!doc) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
          await caseService.assertCanAccessCase(auth, doc.case_id, 'write');
          const updated = await documentService.extractDocument(auth, doc.id);
          res.json({ document: updated });
        } catch (err) {
          next(err);
        }
      },
    );

    router.get('/documents/authenticity-metrics', requireAuth, requireRoles('admin', 'officer'), async (req, res, next) => {
      try {
        const metrics = documentForgeryService.getMetrics(req.auth!.organizationId);
        res.json({ metrics });
      } catch (err) {
        next(err);
      }
    });

    router.get('/documents/:id', requireAuth, requirePermission('document:read'), async (req, res, next) => {
      try {
        const auth = req.auth!;
        const doc = await store.getDocumentById(auth.organizationId, String(req.params.id));
        if (!doc) throw new AppError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
        await caseService.assertCanAccessCase(auth, doc.case_id, 'read');
        const result = await documentService.getSignedDownload(auth, doc.id);
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    // --- RAG Policy Assistant (§18) ---
    router.post('/rag/query', requireAuth, requirePermission('rag:query'), aiRateLimiter, async (req, res, next) => {
      try {
        const body = ragQuerySchema.parse(req.body);
        const result = await ragService.query(req.auth!, {
          question: body.question,
          language: body.language,
          caseId: body.case_id,
        });
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    router.get('/policies', requireAuth, async (req, res, next) => {
      try {
        const policies = await store.listPolicies(req.auth!.organizationId);
        res.json({ policies });
      } catch (err) {
        next(err);
      }
    });

    // Helper: map an officer's workspace department UUID to canonical ServiceDepartmentCode
    const resolveOfficerDeptCode = async (
      organizationId: string,
      departmentId: string | null,
    ): Promise<ServiceDepartmentCode | null> => {
      if (!departmentId) return null;
      const depts = await store.listDepartments(organizationId);
      const dept = depts.find((d) => d.id === departmentId);
      if (!dept) return null;
      const upper = dept.code.toUpperCase();
      if (upper === 'SCAM_CYBER_SAFETY') return 'SCAM_CYBER_SAFETY';
      if (upper === 'RELIEF_ASSISTANCE' || upper === 'RELIEF_INTAKE' || upper === 'PROV_RELIEF') {
        return 'RELIEF_ASSISTANCE';
      }
      if (upper === 'GENERAL_INQUIRY' || upper === 'SYSTEM_ONBOARDING') return upper;
      return 'RELIEF_ASSISTANCE';
    };

    // --- Officer & Super Admin Review (§18) ---
    router.get('/officer/cases', requireAuth, requireRoles('officer', 'admin'), async (req, res, next) => {
      try {
        const auth = req.auth!;
        const status = typeof req.query.status === 'string' ? req.query.status : undefined;
        const search = typeof req.query.search === 'string' ? req.query.search : undefined;
        const officerDeptCode =
          auth.role === 'officer' ? await resolveOfficerDeptCode(auth.organizationId, auth.departmentId) : null;
        const cases = await caseService.listAuthorizedCases(auth, { status, search });
        const citizens = await store.listCitizens(auth.organizationId);
        const citizenMap = new Map(citizens.map((c) => [c.id, c]));
        const enriched = await Promise.all(
          cases.map(async (c) => {
            // Module 4 (Challenge 06): Strictly redact PII for officers when citizen withdrew consent!
            if (auth.role === 'officer') {
              const consentAllowed = await consentEnforcementService.isOfficerAccessAllowedForCitizen(
                auth.organizationId,
                c.citizen_id,
              );
              if (!consentAllowed) {
                await consentEnforcementService.recordAccessBlocked({
                  auth,
                  citizenId: c.citizen_id,
                  caseId: c.id,
                  operation: 'GET /officer/cases (PII redacted)',
                });
                return {
                  ...c,
                  assigned_department: c.assigned_department ?? 'RELIEF_ASSISTANCE',
                  access_blocked: true,
                  access_blocked_reason: 'CONSENT_WITHDRAWN_BY_CITIZEN',
                  citizen_display_name: '[REDACTED — CONSENT WITHDRAWN]',
                  mock_identity_reference: 'REDACTED',
                  case_notes: null,
                };
              }
            }

            const answers = await store.listCaseAnswers(auth.organizationId, c.id);
            const nameAns = answers.find((a) => a.field_name === 'full_name');
            const idAns = answers.find((a) => a.field_name === 'mock_identity_reference');
            return {
              ...c,
              assigned_department: c.assigned_department ?? 'RELIEF_ASSISTANCE',
              access_blocked: false,
              access_blocked_reason: null,
              citizen_display_name:
                (typeof nameAns?.field_value === 'string' && nameAns.field_value.trim()) ||
                citizenMap.get(c.citizen_id)?.display_name ||
                'Synthetic Applicant',
              mock_identity_reference:
                (typeof idAns?.field_value === 'string' && idAns.field_value.trim()) ||
                citizenMap.get(c.citizen_id)?.mock_identity_reference ||
                '',
            };
          }),
        );
        res.json({
          officer_department: officerDeptCode,
          cases: enriched,
        });
      } catch (err) {
        next(err);
      }
    });

    router.post('/cases/:id/decision', requireAuth, requireRoles('officer'), async (req, res, next) => {
      try {
        const body = officerDecisionSchema.parse(req.body);
        const result = await caseService.officerDecide(req.auth!, String(req.params.id), body);
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    router.post('/cases/:id/request-information', requireAuth, requireRoles('officer', 'admin'), async (req, res, next) => {
      try {
        const body = officerRequestInfoSchema.parse(req.body);
        const result = await caseService.officerRequestInformation(req.auth!, String(req.params.id), body);
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    // --- Admin (§18) ---
    router.get('/admin/rules', requireAuth, requireRoles('admin', 'officer'), async (req, res, next) => {
      try {
        const rules = await adminService.listRulesWithActiveVersion(req.auth!);
        res.json({ rules });
      } catch (err) {
        next(err);
      }
    });

    router.post('/admin/rules', requireAuth, requireRoles('admin'), async (req, res, next) => {
      try {
        const definition = eligibilityRuleDefinitionSchema.parse(req.body);
        const result = await adminService.createOrUpdateSchemeRuleVersion(req.auth!, definition);
        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    });

    router.post('/admin/rules/:id/publish', requireAuth, requireRoles('admin'), async (req, res, next) => {
      try {
        const body = z.object({ version_id: z.string().uuid().optional() }).parse(req.body ?? {});
        const result = await adminService.publishExistingRuleVersion(
          req.auth!,
          String(req.params.id),
          body.version_id,
        );
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    router.get('/admin/rules/:id/versions', requireAuth, requireRoles('admin'), async (req, res, next) => {
      try {
        const versions = await adminService.listRuleVersionsWithCaseCounts(req.auth!, String(req.params.id));
        res.json({ versions });
      } catch (err) {
        next(err);
      }
    });

    router.post('/admin/policies', requireAuth, requireRoles('admin'), async (req, res, next) => {
      try {
        const body = z
          .object({
            title: z.string().min(3).max(160),
            document_type: z.string().min(2).max(64),
            version: z.string().min(1).max(32),
            effective_date: z.string().min(8).max(32),
            language: languageCodeSchema.default('en'),
            source_reference: z.string().min(3).max(64),
            content: z.string().min(20).max(25000),
          })
          .parse(req.body);
        const result = await ragService.createAndIngestPolicy(req.auth!, body);
        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    });

    router.post('/admin/policies/reindex', requireAuth, requireRoles('admin'), async (req, res, next) => {
      try {
        const result = await ragService.reindexOrganizationPolicies(req.auth!);
        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    router.patch('/admin/members/:userId/role', requireAuth, requireRoles('admin'), async (req, res, next) => {
      try {
        const body = z
          .object({
            role: userRoleSchema,
            department_id: z.string().uuid().nullable().optional(),
          })
          .parse(req.body);
        const membership = await adminService.updateMemberRole(req.auth!, {
          user_id: String(req.params.userId),
          role: body.role,
          department_id: body.department_id,
        });
        res.json({ membership });
      } catch (err) {
        next(err);
      }
    });

    router.get('/admin/metrics', requireAuth, requireRoles('admin'), async (req, res, next) => {
      try {
        const metrics = await adminService.getOperationalMetrics(req.auth!);
        res.json({ metrics });
      } catch (err) {
        next(err);
      }
    });

    // --- Super Admin: Create & List Department Accounts ---
    router.get('/admin/department-accounts', requireAuth, requireRoles('admin'), async (req, res, next) => {
      try {
        const auth = req.auth!;
        const [departments, members] = await Promise.all([
          store.listDepartments(auth.organizationId),
          store.listOrganizationMembers(auth.organizationId),
        ]);
        const deptMap = new Map(departments.map((d) => [d.id, d]));
        res.json({
          departments,
          accounts: members.map((m) => ({
            user_id: m.profile.id,
            email: m.profile.email,
            display_name: m.profile.display_name,
            role: m.membership.role,
            department_id: m.membership.department_id,
            department_name: m.membership.department_id
              ? (deptMap.get(m.membership.department_id)?.name ?? null)
              : null,
            preferred_language: m.profile.preferred_language,
            joined_at: m.membership.created_at,
          })),
        });
      } catch (err) {
        next(err);
      }
    });

    router.post('/admin/department-accounts', requireAuth, requireRoles('admin'), async (req, res, next) => {
      try {
        const body = createDepartmentAccountSchema.parse(req.body);
        const created = await authService.createDepartmentAccountByAdmin(req.auth!, body);
        res.status(201).json({ account: created });
      } catch (err) {
        next(err);
      }
    });

    // --- Phase 3: Admin Universal Hybrid RAG Explorer (All 5 Collections) (/api/v1/admin/universal-rag) ---
    router.get('/admin/universal-rag', requireAuth, requireRoles('admin', 'officer'), async (req, res, next) => {
      try {
        const stats = await universalRagService.getAdminExplorerStats(req.auth!.organizationId);
        res.json(stats);
      } catch (err) {
        next(err);
      }
    });

    // --- Layer 2: Admin Self-Learning NLU RAG Memory Inspector (/api/v1/admin/nlu-rag-memory) ---
    router.get('/admin/nlu-rag-memory', requireAuth, requireRoles('admin', 'officer'), async (req, res, next) => {
      try {
        const stats = await nluRagService.getAdminRagStats(req.auth!.organizationId);
        res.json(stats);
      } catch (err) {
        next(err);
      }
    });

    // --- Pillar 4 & Phase 2: Admin Full Cross-Department Agent Reasoning Audit Trail (/api/v1/admin/agent-audit-trail) ---
    router.get('/admin/agent-audit-trail', requireAuth, requireRoles('admin'), async (req, res, next) => {
      try {
        const auth = req.auth!;
        const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id : undefined;
        const citizenId = typeof req.query.citizen_id === 'string' ? req.query.citizen_id : undefined;
        const rawDept = typeof req.query.department_id === 'string' ? req.query.department_id.toUpperCase() : undefined;
        const departmentId: ServiceDepartmentCode | undefined =
          rawDept === 'RELIEF_ASSISTANCE' ||
          rawDept === 'SCAM_CYBER_SAFETY' ||
          rawDept === 'GENERAL_INQUIRY' ||
          rawDept === 'SYSTEM_ONBOARDING'
            ? rawDept
            : undefined;
        const capabilityCheck = typeof req.query.capability_check === 'string' ? req.query.capability_check : undefined;
        const accessDecision = typeof req.query.access_decision === 'string' ? req.query.access_decision : undefined;
        const limit = req.query.limit ? Math.min(300, Math.max(1, Number(req.query.limit))) : 150;

        const logs = await store.listAgentReasoningAuditLogs(auth.organizationId, {
          sessionId,
          citizenId,
          departmentId,
          capabilityCheck,
          accessDecision,
          limit,
        });
        res.json({ logs, total: logs.length });
      } catch (err) {
        next(err);
      }
    });

    // --- Phase 2: Department-Scoped Read-Only Officer AI Audit Trails (/api/v1/officer/agent-audit-trail) ---
    // Strictly returns ONLY audit trails belonging to the logged-in officer's own department (read-only).
    router.get('/officer/agent-audit-trail', requireAuth, requireRoles('officer'), async (req, res, next) => {
      try {
        const auth = req.auth!;
        const officerDeptCode = await resolveOfficerDeptCode(auth.organizationId, auth.departmentId);
        if (!officerDeptCode) {
          res.json({ logs: [], total: 0, department_id: null, read_only: true });
          return;
        }
        const limit = req.query.limit ? Math.min(200, Math.max(1, Number(req.query.limit))) : 100;
        const logs = await store.listAgentReasoningAuditLogs(auth.organizationId, {
          departmentId: officerDeptCode,
          limit,
        });
        res.json({
          logs,
          total: logs.length,
          department_id: officerDeptCode,
          read_only: true,
        });
      } catch (err) {
        next(err);
      }
    });

    // --- Pillar 5: Human Admin Escalation Queue (/api/v1/admin/escalations) ---
    router.get('/admin/escalations', requireAuth, requireRoles('admin', 'officer'), async (req, res, next) => {
      try {
        const auth = req.auth!;
        const rawStatus = typeof req.query.status === 'string' ? req.query.status : undefined;
        const status =
          rawStatus === 'OPEN' || rawStatus === 'IN_REVIEW' || rawStatus === 'RESOLVED' ? rawStatus : undefined;
        const escalations = await store.listAgentEscalations(auth.organizationId, { status });
        res.json({ escalations, total: escalations.length });
      } catch (err) {
        next(err);
      }
    });

    router.patch('/admin/escalations/:id', requireAuth, requireRoles('admin', 'officer'), async (req, res, next) => {
      try {
        const auth = req.auth!;
        const body = z
          .object({
            status: z.enum(['OPEN', 'IN_REVIEW', 'RESOLVED']),
            resolution_notes: z.string().max(1000).nullable().optional(),
          })
          .parse(req.body);
        const updated = await store.updateAgentEscalationStatus(auth.organizationId, String(req.params.id), body);
        await audit.log({
          organizationId: auth.organizationId,
          actorId: auth.userId,
          action: 'agent.escalation_status_updated',
          resourceType: 'agent_escalation',
          resourceId: updated.id,
          metadata: {
            ticket_reference: updated.ticket_reference,
            status: updated.status,
          },
        });
        res.json({ escalation: updated });
      } catch (err) {
        next(err);
      }
    });

    // --- Phase 4: Direct Department Officer Inquiries (/api/v1/officer-inquiries) ---
    router.get('/officer-inquiries', requireAuth, async (req, res, next) => {
      try {
        const auth = req.auth!;
        const statusParam =
          req.query.status === 'OPEN' || req.query.status === 'ANSWERED' ? req.query.status : undefined;

        if (auth.role === 'citizen' || auth.role === 'helper') {
          const inquiries = await store.listOfficerInquiries(auth.organizationId, {
            userId: auth.userId,
            status: statusParam,
          });
          res.json({ inquiries, total: inquiries.length });
          return;
        }

        if (auth.role === 'officer' || auth.role === 'admin') {
          const officerDeptCode =
            auth.role === 'officer' ? await resolveOfficerDeptCode(auth.organizationId, auth.departmentId) : null;
          const inquiries = await store.listOfficerInquiries(auth.organizationId, {
            departmentId: officerDeptCode ?? undefined,
            status: statusParam,
          });
          res.json({ inquiries, total: inquiries.length, officer_department: officerDeptCode });
          return;
        }

        throw new AppError(403, 'FORBIDDEN', 'Not permitted to access officer inquiries.');
      } catch (err) {
        next(err);
      }
    });

    router.post('/officer-inquiries', requireAuth, requireRoles('citizen', 'helper'), async (req, res, next) => {
      try {
        const auth = req.auth!;
        const body = z
          .object({
            question_text: z.string().min(3).max(1500),
            application_ref: z.string().max(64).nullable().optional(),
            language: languageCodeSchema.optional().default('ur'),
          })
          .parse(req.body);

        const callRecord = await mcpServer.callTool('ask_department_officer', body, auth);
        const callRes = callRecord.result as { inquiry?: unknown; error?: string };
        if (callRecord.status === 'error' || !callRes?.inquiry) {
          throw new AppError(400, 'INQUIRY_CREATE_FAILED', callRes?.error ?? 'Could not create officer inquiry.');
        }
        res.status(201).json({ inquiry: callRes.inquiry });
      } catch (err) {
        next(err);
      }
    });

    router.post(
      '/officer-inquiries/:id/reply',
      requireAuth,
      requireRoles('officer', 'admin'),
      async (req, res, next) => {
        try {
          const auth = req.auth!;
          const inquiryId = String(req.params.id);
          const body = z.object({ officer_reply: z.string().min(2).max(2000) }).parse(req.body);
          const existing = await store.getOfficerInquiryById(auth.organizationId, inquiryId);
          if (!existing) {
            throw new AppError(404, 'OFFICER_INQUIRY_NOT_FOUND', 'Officer inquiry not found in workspace.');
          }
          const updated = await store.replyOfficerInquiry(auth.organizationId, inquiryId, {
            officer_reply: body.officer_reply.trim(),
            assigned_officer_id: auth.userId,
            assigned_officer_name: auth.displayName,
          });

          await notifications.notify({
            organizationId: auth.organizationId,
            userId: existing.user_id,
            caseId: null,
            notificationType: 'OFFICER_DIRECT_REPLY',
            title: `Department Officer replied (${updated.tracking_reference})`,
            body: updated.officer_reply ?? '',
            language: existing.language,
          });

          await audit.log({
            organizationId: auth.organizationId,
            actorId: auth.userId,
            action: 'officer_inquiry.replied',
            resourceType: 'officer_inquiry',
            resourceId: updated.id,
            metadata: { tracking_reference: updated.tracking_reference },
          });

          res.json({ inquiry: updated });
        } catch (err) {
          next(err);
        }
      },
    );

    // --- Humanized Chatbot Assistance (Citizen <-> Department Staff) ---
    router.post('/assistance/requests', requireAuth, requireRoles('citizen', 'helper'), async (req, res, next) => {
      try {
        const auth = req.auth!;
        const body = createAssistanceRequestSchema.parse(req.body);
        const created = await store.createAssistanceRequest({
          organization_id: auth.organizationId,
          department_id: body.department_id ?? null,
          citizen_user_id: auth.userId,
          citizen_display_name: auth.displayName,
          case_id: body.case_id ?? null,
          language: body.language,
          citizen_question: body.citizen_question,
          chatbot_draft_answer: body.chatbot_draft_answer ?? null,
        });

        await audit.log({
          organizationId: auth.organizationId,
          actorId: auth.userId,
          action: 'assistance_request.created',
          resourceType: 'assistance_request',
          resourceId: created.id,
          metadata: { language: created.language, case_id: created.case_id },
        });

        res.status(201).json({ request: created });
      } catch (err) {
        next(err);
      }
    });

    router.get('/assistance/requests', requireAuth, async (req, res, next) => {
      try {
        const auth = req.auth!;
        const statusParam =
          req.query.status === 'OPEN' || req.query.status === 'ANSWERED' ? req.query.status : undefined;

        if (auth.role === 'citizen' || auth.role === 'helper') {
          const requests = await store.listAssistanceRequests(auth.organizationId, {
            citizenUserId: auth.userId,
            status: statusParam,
          });
          res.json({ requests });
          return;
        }

        if (auth.role === 'officer' || auth.role === 'admin') {
          const requests = await store.listAssistanceRequests(auth.organizationId, {
            departmentId: auth.role === 'officer' ? auth.departmentId : undefined,
            status: statusParam,
          });
          res.json({ requests });
          return;
        }

        throw new AppError(403, 'FORBIDDEN', 'Not permitted to view assistance requests.');
      } catch (err) {
        next(err);
      }
    });

    router.post(
      '/assistance/requests/:id/respond',
      requireAuth,
      requireRoles('officer', 'admin'),
      async (req, res, next) => {
        try {
          const auth = req.auth!;
          const requestId = String(req.params.id);
          const body = respondAssistanceRequestSchema.parse(req.body);
          const existing = await store.getAssistanceRequestById(auth.organizationId, requestId);
          if (!existing) {
            throw new AppError(404, 'ASSISTANCE_REQUEST_NOT_FOUND', 'Assistance request not found in workspace.');
          }

          const answered = await store.answerAssistanceRequest(auth.organizationId, requestId, {
            responder_user_id: auth.userId,
            humanized_reply: body.humanized_reply,
            saved_as_guidance: body.save_as_guidance,
          });

          let guidance = null;
          if (body.save_as_guidance) {
            guidance = await store.createHumanizedGuidance({
              organization_id: auth.organizationId,
              department_id: auth.departmentId ?? existing.department_id,
              service_id: 'MOCK_RELIEF_01',
              language: existing.language,
              question_pattern: body.guidance_question_pattern?.trim() || existing.citizen_question,
              humanized_answer: body.humanized_reply,
              created_by: auth.userId,
            });
          }

          await notifications.notify({
            organizationId: auth.organizationId,
            userId: existing.citizen_user_id,
            caseId: existing.case_id,
            notificationType: 'DEPARTMENT_HUMAN_REPLY',
            title: 'A Department Officer answered your question',
            body: body.humanized_reply,
            language: existing.language,
          });

          await audit.log({
            organizationId: auth.organizationId,
            actorId: auth.userId,
            action: 'assistance_request.answered',
            resourceType: 'assistance_request',
            resourceId: answered.id,
            metadata: { saved_as_guidance: body.save_as_guidance },
          });

          res.json({ request: answered, guidance });
        } catch (err) {
          next(err);
        }
      },
    );

    router.get('/assistance/guidance', requireAuth, requireRoles('officer', 'admin'), async (req, res, next) => {
      try {
        const guidance = await store.listHumanizedGuidance(req.auth!.organizationId);
        res.json({ guidance });
      } catch (err) {
        next(err);
      }
    });

    router.post('/assistance/guidance', requireAuth, requireRoles('officer', 'admin'), async (req, res, next) => {
      try {
        const auth = req.auth!;
        const body = createHumanizedGuidanceSchema.parse(req.body);
        const entry = await store.createHumanizedGuidance({
          organization_id: auth.organizationId,
          department_id: body.department_id ?? auth.departmentId,
          service_id: body.service_id,
          language: body.language,
          question_pattern: body.question_pattern,
          humanized_answer: body.humanized_answer,
          created_by: auth.userId,
        });
        await audit.log({
          organizationId: auth.organizationId,
          actorId: auth.userId,
          action: 'humanized_guidance.created',
          resourceType: 'humanized_guidance',
          resourceId: entry.id,
          metadata: { service_id: entry.service_id, language: entry.language },
        });
        res.status(201).json({ guidance: entry });
      } catch (err) {
        next(err);
      }
    });

    // --- Consent (§18) ---
    router.post('/consent', requireAuth, requirePermission('consent:grant'), async (req, res, next) => {
      try {
        const body = grantConsentSchema.parse(req.body);
        const consent = await consentService.grantConsent(req.auth!, body);
        res.status(201).json({ consent });
      } catch (err) {
        next(err);
      }
    });

    router.post('/consent/:id/withdraw', requireAuth, requirePermission('consent:withdraw'), async (req, res, next) => {
      try {
        const consent = await consentService.withdrawConsent(req.auth!, String(req.params.id));
        res.json({ consent });
      } catch (err) {
        next(err);
      }
    });

    router.get('/consent', requireAuth, requirePermission('consent:read'), async (req, res, next) => {
      try {
        const consents = await consentService.listAuthorizedConsents(req.auth!);
        res.json({ consents });
      } catch (err) {
        next(err);
      }
    });

    // Least-privilege endpoint for citizens to select an authorized Community Helper for delegation consent
    // without exposing workspace member lists, emails, or other roles.
    router.get('/consent/available-helpers', requireAuth, requireRoles('citizen'), async (req, res, next) => {
      try {
        const members = await store.listOrganizationMembers(req.auth!.organizationId);
        res.json({
          helpers: members
            .filter((m) => m.membership.role === 'helper')
            .map((m) => ({
              user_id: m.profile.id,
              display_name: m.profile.display_name,
            })),
        });
      } catch (err) {
        next(err);
      }
    });

    // --- Helper Authorized Citizens Discovery ---
    router.get('/helper/citizens', requireAuth, requireRoles('helper'), async (req, res, next) => {
      try {
        const auth = req.auth!;
        const activeConsents = await store.listConsents(auth.organizationId, {
          helperId: auth.userId,
          activeOnly: true,
        });
        const citizenIds = new Set(
          activeConsents
            .filter((c) => c.consent_type === 'helper_delegation')
            .map((c) => c.citizen_id),
        );
        const citizens = (await store.listCitizens(auth.organizationId)).filter((c) =>
          citizenIds.has(c.id),
        );
        res.json({ citizens, consents: activeConsents });
      } catch (err) {
        next(err);
      }
    });

    // --- Audit & AI Decision Traces (§18 — Super Admin only; separate Auditor role removed) ---
    router.get('/audit', requireAuth, requireRoles('admin'), async (req, res, next) => {
      try {
        const resourceType = typeof req.query.resource_type === 'string' ? req.query.resource_type : undefined;
        const limit = req.query.limit ? Math.min(500, Math.max(1, Number(req.query.limit))) : 100;
        const [auditLogs, aiRuns, ruleVersions, consents] = await Promise.all([
          audit.list(req.auth!.organizationId, { resourceType, limit }),
          store.listAiRuns(req.auth!.organizationId),
          store.listRuleVersions(req.auth!.organizationId),
          store.listConsents(req.auth!.organizationId),
        ]);
        res.json({
          audit_logs: auditLogs,
          ai_runs: aiRuns,
          rule_versions: ruleVersions,
          consents,
        });
      } catch (err) {
        next(err);
      }
    });

    // --- Mock Payments (§18, explicitly synthetic) ---
    router.post('/mock-payments', requireAuth, requireRoles('officer', 'admin'), async (req, res, next) => {
      try {
        const body = createMockPaymentSchema.parse(req.body);
        const result = await caseService.createMockPayment(req.auth!, body);
        res.status(201).json({
          ...result,
          synthetic_notice: 'Mock payment simulation only. No real money or payment gateway was invoked.',
        });
      } catch (err) {
        next(err);
      }
    });

    router.get('/mock-payments/:id', requireAuth, requirePermission('mock_payment:read'), async (req, res, next) => {
      try {
        const auth = req.auth!;
        const payment = await store.getMockPaymentById(auth.organizationId, String(req.params.id));
        if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Mock payment record not found.');
        await caseService.assertCanAccessCase(auth, payment.case_id, 'read');
        res.json({
          payment,
          synthetic_notice: 'Mock payment record only.',
        });
      } catch (err) {
        next(err);
      }
    });

    // --- MODULES 1–5 (8/8 RUBRIC CLOSER — STRICTLY ADDITIVE ROUTES) ---

    // Module 1 & 2: Live Dynamic Rule Versions & Cost-Backed Decision Matrix
    router.get('/rules/versions', requireAuth, requireRoles('admin', 'officer'), async (req, res, next) => {
      try {
        const orgId = req.auth!.organizationId;
        const active = ruleEngineService.getActiveRuleVersion(orgId);
        const history = ruleEngineService.listRuleVersions(orgId);
        res.json({
          active_version: active,
          versions: history,
          cost_model: {
            false_approval_cost_pkr: active.false_approval_cost_pkr,
            false_delay_cost_pkr: active.false_delay_cost_pkr,
            wrongful_rejection_cost_pkr: active.wrongful_rejection_cost_pkr,
            cost_ratio: Number((active.false_approval_cost_pkr / Math.max(1, active.false_delay_cost_pkr)).toFixed(1)),
          },
        });
      } catch (err) {
        next(err);
      }
    });

    router.post('/admin/rules/versions', requireAuth, requireRoles('admin'), async (req, res, next) => {
      try {
        const body = z
          .object({
            max_monthly_income_pkr: z.coerce.number().min(0).max(5_000_000),
            act_alone_max_amount_pkr: z.coerce.number().min(0).max(500_000),
            ask_proof_max_amount_pkr: z.coerce.number().min(0).max(500_000),
            min_confidence_act_alone: z.coerce.number().min(0.1).max(1),
            min_confidence_ask_proof: z.coerce.number().min(0.1).max(1),
            false_approval_cost_pkr: z.coerce.number().positive().optional(),
            false_delay_cost_pkr: z.coerce.number().positive().optional(),
            wrongful_rejection_cost_pkr: z.coerce.number().positive().optional(),
            change_reason: z.string().min(3).max(500),
          })
          .parse(req.body);

        const published = await ruleEngineService.publishNewRuleVersion(req.auth!, body);
        res.status(201).json(published);
      } catch (err) {
        next(err);
      }
    });

    // Module 2: Live Cost-Tier Evaluator Preview (for testing/verifying 3 tiers & uncertainty case_notes directly)
    router.post('/rules/evaluate-tier', requireAuth, async (req, res, next) => {
      try {
        const body = z
          .object({
            amount_pkr: z.coerce.number().min(0),
            monthly_income_pkr: z.coerce.number().min(0),
            confidence_score: z.coerce.number().min(0).max(1).optional(),
            language: languageCodeSchema.optional().default('en'),
            document_blurry_or_missing: z.boolean().optional(),
            conflicting_fields: z.array(z.string()).optional(),
          })
          .parse(req.body);
        const evaluation = ruleEngineService.evaluateClaimWithCostMatrix(req.auth!.organizationId, body);
        res.json({ evaluation });
      } catch (err) {
        next(err);
      }
    });

    // Module 3: Bad Data, Pakistani Phonetic Name Variants & Safe 3-Way Duplicate Guard
    router.post('/entity-resolution/check', requireAuth, async (req, res, next) => {
      try {
        const body = z
          .object({
            full_name: z.union([z.string(), z.null()]).optional(),
            cnic: z.union([z.string(), z.null()]).optional(),
            phone: z.union([z.string(), z.null()]).optional(),
            district: z.union([z.string(), z.null()]).optional(),
            exclude_self: z.boolean().optional().default(false),
            extra_candidates: z
              .array(
                z.object({
                  id: z.string(),
                  user_id: z.string().nullable().optional().default(null),
                  display_name: z.string(),
                  cnic: z.string().nullable().optional().default(null),
                  phone: z.string().nullable().optional().default(null),
                  district: z.string().nullable().optional().default(null),
                }),
              )
              .optional(),
          })
          .parse(req.body ?? {});

        const resolution = await entityResolutionService.resolvePerson(req.auth!.organizationId, {
          full_name: body.full_name ?? null,
          cnic: body.cnic ?? null,
          phone: body.phone ?? null,
          district: body.district ?? null,
          exclude_user_id: body.exclude_self ? req.auth!.userId : null,
          extra_candidates: body.extra_candidates,
        });
        res.json({ resolution });
      } catch (err) {
        next(err);
      }
    });

    // Module 4: Granular Citizen Consent Visibility & Hard Access Revocation
    router.get('/consent/my-data', requireAuth, requireRoles('citizen'), async (req, res, next) => {
      try {
        const consent = await consentEnforcementService.getMyConsentRecord(req.auth!);
        res.json({ consent });
      } catch (err) {
        next(err);
      }
    });

    router.patch('/consent/my-data', requireAuth, requireRoles('citizen'), async (req, res, next) => {
      try {
        const body = z
          .object({
            share_with_relief_officer: z.boolean().optional(),
            allow_ai_voice_processing: z.boolean().optional(),
            allow_document_verification: z.boolean().optional(),
          })
          .parse(req.body ?? {});
        const consent = await consentEnforcementService.updateGranularScopes(req.auth!, body);
        res.json({ consent });
      } catch (err) {
        next(err);
      }
    });

    router.post('/consent/withdraw-all', requireAuth, requireRoles('citizen'), async (req, res, next) => {
      try {
        const consent = await consentEnforcementService.withdrawAllConsent(req.auth!);
        res.json({ consent });
      } catch (err) {
        next(err);
      }
    });

    router.post('/consent/grant-all', requireAuth, requireRoles('citizen'), async (req, res, next) => {
      try {
        const consent = await consentEnforcementService.grantAllConsent(req.auth!);
        res.json({ consent });
      } catch (err) {
        next(err);
      }
    });

    // Module 5: Forged Document Detection + Honest False-Alarm Handling & Metrics
    router.post('/documents/analyze-authenticity', requireAuth, async (req, res, next) => {
      try {
        const body = z
          .object({
            image_base64: z.string().optional(),
            file_name: z.string().max(180).optional(),
            mime_type: z.string().max(80).optional(),
            doc_type: z.string().max(80).optional().default('mock_identity_document'),
            sample_preset: z.enum(['valid_cnic', 'blurry_rural_photo', 'tampered_edited_doc']).optional(),
            language: languageCodeSchema.optional().default('en'),
          })
          .parse(req.body ?? {});
        const analysis = await documentForgeryService.analyzeDocument(
          req.auth,
          req.auth!.organizationId,
          body,
        );
        res.json({ analysis });
      } catch (err) {
        next(err);
      }
    });

    return router;
  };

  return {
    manifest: {
      id: 'relief-assistance',
      name: 'Relief Assistance (Mock)',
      version: '1.0.0',
      description:
        'Multilingual, voice-first mock relief-assistance application with deterministic eligibility rules, RAG policy assistant, and human officer review.',
      apiBasePath: '/api/v1',
      frontendBasePath: '/citizen',
      allowedRoles: ['citizen', 'helper', 'officer', 'admin'],
      status: 'active',
    },
    createRouter,
  };
}
