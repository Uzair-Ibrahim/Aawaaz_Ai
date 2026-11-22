-- 0010_universal_rag_collections.sql
-- Universal Hybrid RAG Collections + Hard Language Lock + LangGraph Execution Audit Trail

CREATE TABLE IF NOT EXISTS public.universal_rag_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  collection TEXT NOT NULL CHECK (
    collection IN (
      'policy_and_services_kb',
      'scam_and_fraud_kb',
      'multilingual_nlu_slang_kb',
      'episodic_conversation_kb',
      'self_learning_corrections_kb'
    )
  ),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'ur',
  session_id TEXT NULL,
  citizen_id TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  hit_count INTEGER NOT NULL DEFAULT 0,
  embedding JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_universal_rag_collection_org
  ON public.universal_rag_documents (collection, organization_id);

CREATE INDEX IF NOT EXISTS idx_universal_rag_session
  ON public.universal_rag_documents (session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_universal_rag_citizen
  ON public.universal_rag_documents (citizen_id)
  WHERE citizen_id IS NOT NULL;

ALTER TABLE public.agent_memory_sessions
  ADD COLUMN IF NOT EXISTS locked_language TEXT NULL,
  ADD COLUMN IF NOT EXISTS language_switch_history JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.agent_reasoning_audit_logs
  ADD COLUMN IF NOT EXISTS locked_language TEXT NULL,
  ADD COLUMN IF NOT EXISTS language_guard_status TEXT NULL,
  ADD COLUMN IF NOT EXISTS langgraph_nodes_visited JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS universal_rag_chunks JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS mcp_protocol_info JSONB NULL;
