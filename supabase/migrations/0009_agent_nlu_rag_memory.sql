-- Layer 1 & Layer 2: Sliding Context Window, Field Provenance & Self-Learning NLU Correction RAG Memory
ALTER TABLE IF EXISTS public.agent_memory_sessions
  ADD COLUMN IF NOT EXISTS conversation_window jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS context_summary text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS field_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS turn_counter integer NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS public.agent_reasoning_audit_logs
  ADD COLUMN IF NOT EXISTS rag_memories_retrieved jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS learned_memory_saved jsonb,
  ADD COLUMN IF NOT EXISTS semantic_nlu_summary jsonb;

CREATE TABLE IF NOT EXISTS public.agent_nlu_rag_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('SEED_EXEMPLAR', 'LEARNED_FROM_CORRECTION', 'LEARNED_FROM_CONFIRMATION')),
  raw_utterance text NOT NULL,
  resolved_intent text NOT NULL,
  target_field text,
  clean_value jsonb,
  language text NOT NULL DEFAULT 'ur',
  hit_count integer NOT NULL DEFAULT 0,
  embedding jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_nlu_rag_memory_source_hits
  ON public.agent_nlu_rag_memory (source, hit_count DESC, updated_at DESC);
