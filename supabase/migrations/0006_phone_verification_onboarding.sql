-- Awaaz Migration 0006: Phone Verification & Citizen Onboarding Support
-- Adds private phone verification columns on profiles and a server-only OTP challenge table.
-- Preserves all existing tenancy boundaries, RLS policies, audit logs, and role permissions.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_number TEXT,
  ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_phone_number_unique
  ON public.profiles (phone_number)
  WHERE phone_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.phone_otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_otp_challenges_phone_created
  ON public.phone_otp_challenges (phone_number, created_at DESC);

-- Enable RLS with NO client policies: phone_otp_challenges is strictly service-role/backend-only.
ALTER TABLE public.phone_otp_challenges ENABLE ROW LEVEL SECURITY;
