import type { LanguageCode, PolicyChunkRecord, PolicyRecord } from '@awaaz/shared';
import type { AuditService } from '../../../core/audit/audit-service';
import type { AuthContext } from '../../../core/auth/auth-service';
import type { DataStore } from '../../../core/database/types';
import { sha256Hex } from '../../../core/security/crypto';
import type { AIProvider } from '../../../integrations/ai/provider';

export interface RagQueryResult {
  answer: string;
  language: LanguageCode;
  retrieval_mode: 'pgvector_gemini' | 'lexical_excerpt_only' | 'department_humanized_guidance';
  grounded: boolean;
  requires_officer_routing: boolean;
  citations: Array<{
    title: string;
    section: string;
    source_reference: string;
    excerpt: string;
  }>;
  notice?: string;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

function lexicalScore(queryTokens: string[], chunkText: string, title: string): number {
  if (queryTokens.length === 0) return 0;
  const hay = `${title} ${chunkText}`.toLowerCase();
  let score = 0;
  for (const tok of queryTokens) {
    if (hay.includes(tok)) score += 1;
  }
  return score / queryTokens.length;
}

export function splitPolicyIntoChunks(policy: PolicyRecord): Array<Omit<PolicyChunkRecord, 'id' | 'organization_id' | 'policy_id' | 'created_at'>> {
  const paragraphs = policy.content
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: Array<Omit<PolicyChunkRecord, 'id' | 'organization_id' | 'policy_id' | 'created_at'>> = [];
  paragraphs.forEach((para, idx) => {
    const section = para.includes(':') ? (para.split(':')[0] ?? `Section ${idx + 1}`).trim() : `Section ${idx + 1}`;
    chunks.push({
      chunk_text: para,
      embedding: null,
      metadata: {
        title: policy.title,
        version: policy.version,
        section,
        source_reference: policy.source_reference,
        language: policy.language,
      },
    });
  });
  return chunks;
}

export class RagService {
  private readonly answerCache = new Map<string, { expiresAt: number; result: RagQueryResult }>();

  constructor(
    private readonly store: DataStore,
    private readonly aiProvider: AIProvider,
    private readonly audit: AuditService,
  ) {}

  async createAndIngestPolicy(
    auth: AuthContext,
    input: {
      title: string;
      document_type: string;
      version: string;
      effective_date: string;
      language: LanguageCode;
      source_reference: string;
      content: string;
    },
  ): Promise<{ policy: PolicyRecord; chunkCount: number; embedded: boolean }> {
    const contentHash = sha256Hex(input.content.trim());
    const policy = await this.store.createPolicy({
      organization_id: auth.organizationId,
      title: input.title,
      document_type: input.document_type,
      version: input.version,
      effective_date: input.effective_date,
      language: input.language,
      source_reference: input.source_reference,
      storage_path: `org/${auth.organizationId}/policies/${input.source_reference}.md`,
      content: input.content.trim(),
      content_hash: contentHash,
    });

    const baseChunks = splitPolicyIntoChunks(policy);
    let embedded = false;

    if (this.aiProvider.isConfigured() && baseChunks.length > 0) {
      try {
        const vectors = await this.aiProvider.embedTexts(baseChunks.map((c) => c.chunk_text));
        baseChunks.forEach((chunk, idx) => {
          chunk.embedding = vectors[idx] ?? null;
        });
        embedded = vectors.every((v) => v.length > 0);
      } catch {
        // Store chunks cleanly even if embedding fails transiently; lexical retrieval still works
        embedded = false;
      }
    }

    await this.store.replacePolicyChunks(auth.organizationId, policy.id, baseChunks);
    this.answerCache.clear();

    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'policy.ingested',
      resourceType: 'policy',
      resourceId: policy.id,
      metadata: {
        source_reference: policy.source_reference,
        chunk_count: baseChunks.length,
        embedded,
      },
    });

    return { policy, chunkCount: baseChunks.length, embedded };
  }

  async reindexOrganizationPolicies(auth: AuthContext): Promise<{ policiesProcessed: number; embeddedChunks: number }> {
    const policies = await this.store.listPolicies(auth.organizationId);
    let embeddedChunks = 0;

    for (const policy of policies) {
      const chunks = splitPolicyIntoChunks(policy);
      if (this.aiProvider.isConfigured() && chunks.length > 0) {
        const vectors = await this.aiProvider.embedTexts(chunks.map((c) => c.chunk_text));
        chunks.forEach((c, idx) => {
          c.embedding = vectors[idx] ?? null;
          if (c.embedding && c.embedding.length > 0) embeddedChunks += 1;
        });
      }
      await this.store.replacePolicyChunks(auth.organizationId, policy.id, chunks);
    }

    this.answerCache.clear();
    return { policiesProcessed: policies.length, embeddedChunks };
  }

  async query(
    auth: AuthContext,
    input: { question: string; language: LanguageCode; caseId?: string },
  ): Promise<RagQueryResult> {
    const cacheKey = sha256Hex(`${auth.organizationId}:${input.language}:${input.question.trim().toLowerCase()}`);
    const cached = this.answerCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    // 1. Check Department Humanized Guidance first (department staff overrides for this organization's service)
    const guidanceEntries = await this.store.listHumanizedGuidance(auth.organizationId);
    if (guidanceEntries.length > 0) {
      const qTokens = tokenize(input.question);
      const bestGuidance = guidanceEntries
        .map((g) => ({
          entry: g,
          score: lexicalScore(qTokens, g.question_pattern, g.humanized_answer) + (g.language === input.language ? 0.15 : 0),
        }))
        .filter((x) => x.score >= 0.45)
        .sort((a, b) => b.score - a.score)[0];

      if (bestGuidance) {
        const g = bestGuidance.entry;
        return {
          answer: g.humanized_answer,
          language: input.language,
          retrieval_mode: 'department_humanized_guidance',
          grounded: true,
          requires_officer_routing: false,
          citations: [
            {
              title: 'Department Humanized Guidance',
              section: g.question_pattern,
              source_reference: `DEPT-GUIDE-${g.id.slice(0, 6).toUpperCase()}`,
              excerpt: g.humanized_answer,
            },
          ],
        };
      }
    }

    let retrieved: Array<PolicyChunkRecord & { similarity: number }> = [];
    let usedVectorSearch = false;

    if (this.aiProvider.isConfigured()) {
      try {
        const [queryEmbedding] = await this.aiProvider.embedTexts([input.question]);
        if (queryEmbedding && queryEmbedding.length > 0) {
          retrieved = await this.store.searchPolicyChunksByEmbedding(
            auth.organizationId,
            queryEmbedding,
            4,
          );
          usedVectorSearch = retrieved.length > 0;
        }
      } catch {
        usedVectorSearch = false;
      }
    }

    // Lexical fallback over tenant-scoped synthetic policy chunks
    if (retrieved.length === 0) {
      const allChunks = await this.store.listPolicyChunks(auth.organizationId);
      const qTokens = tokenize(input.question);
      retrieved = allChunks
        .map((chunk) => ({
          ...chunk,
          similarity: lexicalScore(qTokens, chunk.chunk_text, chunk.metadata.title),
        }))
        .filter((c) => c.similarity > 0)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 4);
    }

    const citations = retrieved.map((c) => ({
      title: c.metadata.title,
      section: c.metadata.section,
      source_reference: c.metadata.source_reference,
      excerpt: c.chunk_text,
    }));

    // If Gemini is configured, generate grounded answer with strict untrusted-data fencing
    if (this.aiProvider.isConfigured()) {
      const generated = await this.aiProvider.generateGroundedPolicyAnswer({
        question: input.question,
        language: input.language,
        retrievedChunks: retrieved.map((c) => ({
          title: c.metadata.title,
          section: c.metadata.section,
          source_reference: c.metadata.source_reference,
          chunk_text: c.chunk_text,
        })),
      });

      const result: RagQueryResult = {
        answer: generated.answer,
        language: input.language,
        retrieval_mode: usedVectorSearch ? 'pgvector_gemini' : 'lexical_excerpt_only',
        grounded: generated.grounded,
        requires_officer_routing: generated.requires_officer_routing,
        citations: citations.filter(
          (c) =>
            generated.citations.length === 0 ||
            generated.citations.some((gc) => gc.source_reference === c.source_reference),
        ),
      };

      await this.store.createAiRun({
        organization_id: auth.organizationId,
        case_id: input.caseId ?? null,
        model_provider: this.aiProvider.providerName,
        model_name: generated.model_name,
        operation: 'rag_policy_query',
        input_reference: `lang:${input.language}:chunks:${retrieved.length}`,
        output: {
          grounded: result.grounded,
          requires_officer_routing: result.requires_officer_routing,
          cited_sources: result.citations.map((c) => c.source_reference),
        },
        confidence: null,
        explanation: 'Grounded policy answer generated from tenant synthetic policy documents.',
      });

      if (this.answerCache.size < 200) {
        this.answerCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60 * 1000, result });
      }
      return result;
    }

    // Honest non-AI lexical excerpt response when GEMINI_API_KEY is not configured
    const hasMatches = citations.length > 0;
    const result: RagQueryResult = {
      answer: hasMatches
        ? `GEMINI_API_KEY is not configured, so AI synthesis is disabled. Showing matching synthetic policy excerpts directly:\n\n${citations
            .map((c) => `[${c.source_reference} — ${c.section}] ${c.excerpt}`)
            .join('\n\n')}`
        : 'No matching synthetic policy excerpt was found for your question. Please contact an authorized Department Officer for assistance.',
      language: input.language,
      retrieval_mode: 'lexical_excerpt_only',
      grounded: hasMatches,
      requires_officer_routing: !hasMatches,
      citations,
      notice:
        'AI response synthesis requires GEMINI_API_KEY on the backend server. Displaying direct synthetic policy excerpts without LLM generation.',
    };
    return result;
  }
}
