import path from 'node:path';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { DEFAULT_DEPARTMENT_IDS, DEFAULT_ORG_IDS, SYNTHETIC_MOCK_IDENTITIES } from '../src/core/database/seed-data';
import { hashPassword } from '../src/core/security/crypto';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const PERSONA_ACCOUNTS = [
  {
    id: 'aaaa5555-1111-4111-8111-111111111111',
    username: 'admin_ayesha',
    email: 'admin_ayesha@demo.awaaz.local',
    password: 'admin123',
    display_name: 'Admin Ayesha (Super Admin)',
    role: 'admin',
    deptId: DEFAULT_DEPARTMENT_IDS.RELIEF_ASSISTANCE,
    lang: 'en',
  },
  {
    id: 'aaaa6666-1111-4111-8111-111111111111',
    username: 'officer_hamza',
    email: 'officer_hamza@demo.awaaz.local',
    password: 'officer123',
    display_name: 'Officer Hamza (Relief Assistance)',
    role: 'officer',
    deptId: DEFAULT_DEPARTMENT_IDS.RELIEF_ASSISTANCE,
    lang: 'en',
  },
  {
    id: 'aaaa6667-1111-4111-8111-111111111111',
    username: 'officer_sana',
    email: 'officer_sana@demo.awaaz.local',
    password: 'officer123',
    display_name: 'Officer Sana (Scam & Cyber Safety)',
    role: 'officer',
    deptId: DEFAULT_DEPARTMENT_IDS.SCAM_CYBER_SAFETY,
    lang: 'en',
  },
  {
    id: 'aaaa7777-1111-4111-8111-111111111111',
    username: 'auditor_bilal',
    email: 'auditor_bilal@demo.awaaz.local',
    password: 'auditor123',
    display_name: 'Auditor Bilal (Audit Inspector)',
    role: 'admin',
    deptId: DEFAULT_DEPARTMENT_IDS.RELIEF_ASSISTANCE,
    lang: 'en',
  },
  {
    id: 'aaaa8888-1111-4111-8111-111111111111',
    username: 'citizen_zainab',
    email: 'citizen_zainab@demo.awaaz.local',
    password: 'citizen123',
    display_name: 'Zainab Bibi',
    role: 'citizen',
    deptId: null,
    lang: 'ur',
    phone: '+923001112233',
    cnic: '42101-1234567-2',
  },
  {
    id: 'aaaa9999-1111-4111-8111-111111111111',
    username: 'helper_salma',
    email: 'helper_salma@demo.awaaz.local',
    password: 'helper123',
    display_name: 'Helper Salma (Community Helper)',
    role: 'helper',
    deptId: null,
    lang: 'ur',
  },
] as const;

async function connectPg(): Promise<Client> {
  const candidates = [
    process.env.SUPABASE_POOLER_URL?.trim(),
    process.env.DATABASE_URL?.trim(),
  ].filter(Boolean) as string[];

  const raw = process.env.DATABASE_URL?.trim() ?? '';
  const match = raw.match(/^postgresql:\/\/([^:]+):([^@]+)@db\.([a-z0-9]+)\.supabase\.co:5432\/(.+)$/i);
  if (match) {
    const [, user, pass, projectRef, dbName] = match;
    candidates.push(`postgresql://${user}.${projectRef}:${pass}@aws-1-ap-northeast-2.pooler.supabase.com:5432/${dbName}`);
  }

  let lastErr = 'No DATABASE_URL configured.';
  for (const conn of candidates) {
    const client = new Client({
      connectionString: conn,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 6000,
    });
    try {
      await client.connect();
      return client;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      await client.end().catch(() => {});
    }
  }
  throw new Error(lastErr);
}

async function main() {
  console.log('[db:seed] Connecting to Supabase PostgreSQL...');
  const client = await connectPg();

  try {
    // 1. Seed Organizations & Departments
    await client.query(
      `INSERT INTO public.organizations (id, name, slug, plan_tier, enabled_modules)
       VALUES ($1, 'Awaaz Demo Relief District (Synthetic)', 'awaaz-demo-district', 'free', ARRAY['relief-assistance']),
              ($2, 'Northern Relief Authority Sandbox (Synthetic)', 'northern-relief-sandbox', 'standard', ARRAY['relief-assistance'])
       ON CONFLICT (id) DO NOTHING`,
      [DEFAULT_ORG_IDS.RELIEF_DEMO, DEFAULT_ORG_IDS.PROVINCE_BETA],
    );

    await client.query(
      `INSERT INTO public.departments (id, organization_id, name, code)
       VALUES ($1, $4, 'Relief Assistance Department', 'RELIEF_ASSISTANCE'),
              ($2, $4, 'Scam & Cyber Safety Department', 'SCAM_CYBER_SAFETY'),
              ($3, $5, 'Provincial Relief Unit', 'RELIEF_ASSISTANCE')
       ON CONFLICT (id) DO NOTHING`,
      [
        DEFAULT_DEPARTMENT_IDS.RELIEF_ASSISTANCE,
        DEFAULT_DEPARTMENT_IDS.SCAM_CYBER_SAFETY,
        DEFAULT_DEPARTMENT_IDS.PROV_RELIEF,
        DEFAULT_ORG_IDS.RELIEF_DEMO,
        DEFAULT_ORG_IDS.PROVINCE_BETA,
      ],
    );

    // 2. Seed all 6 demo accounts (auth.users + profiles + memberships + demo credentials)
    for (const acc of PERSONA_ACCOUNTS) {
      await client.query(
        `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
         VALUES ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', NOW(), '{"provider":"email","providers":["email"]}'::jsonb, $3::jsonb, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [acc.id, acc.email, JSON.stringify({ display_name: acc.display_name, username: acc.username })],
      );

      await client.query(
        `INSERT INTO public.profiles (id, email, display_name, role, default_organization_id, department_id, preferred_language)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, department_id = EXCLUDED.department_id`,
        [acc.id, acc.email, acc.display_name, acc.role, DEFAULT_ORG_IDS.RELIEF_DEMO, acc.deptId, acc.lang],
      );

      await client.query(
        `INSERT INTO public.organization_memberships (organization_id, user_id, role, department_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role, department_id = EXCLUDED.department_id`,
        [DEFAULT_ORG_IDS.RELIEF_DEMO, acc.id, acc.role, acc.deptId],
      );

      const pwdHash = hashPassword(acc.password);
      for (const ident of [acc.username, acc.email]) {
        await client.query(
          `INSERT INTO public.awaaz_demo_credentials (identifier, user_id, email, password_hash)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (identifier) DO NOTHING`,
          [ident.toLowerCase(), acc.id, acc.email, pwdHash],
        );
      }
    }

    // 3. Seed Synthetic Citizen Zainab + Mock Identity Records
    await client.query(
      `INSERT INTO public.citizens (id, organization_id, user_id, display_name, mock_identity_reference)
       VALUES ('cccc8888-1111-4111-8111-111111111111', $1, 'aaaa8888-1111-4111-8111-111111111111', 'Zainab Bibi', '42101-1234567-2')
       ON CONFLICT (id) DO NOTHING`,
      [DEFAULT_ORG_IDS.RELIEF_DEMO],
    );

    for (const ident of SYNTHETIC_MOCK_IDENTITIES) {
      await client.query(
        `INSERT INTO public.mock_identity_records (organization_id, mock_identity_reference, full_name, district, verified)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (organization_id, mock_identity_reference) DO NOTHING`,
        [DEFAULT_ORG_IDS.RELIEF_DEMO, ident.mock_identity_reference, ident.full_name, ident.district, ident.verified],
      );
    }

    // 4. Seed Active Dynamic Policy Rule v1.0
    const existingRule = await client.query(
      `SELECT id FROM public.eligibility_rule_versions WHERE organization_id = $1 AND version = 'v1.0' LIMIT 1`,
      [DEFAULT_ORG_IDS.RELIEF_DEMO],
    );
    if (!existingRule.rowCount) {
      await client.query(
        `INSERT INTO public.eligibility_rule_versions (
          organization_id, version, is_active, max_monthly_income_pkr, act_alone_max_amount_pkr,
          ask_proof_max_amount_pkr, min_confidence_act_alone, min_confidence_ask_proof,
          false_approval_cost_pkr, false_delay_cost_pkr, wrongful_rejection_cost_pkr,
          change_reason, updated_by
        ) VALUES ($1, 'v1.0', TRUE, 25000, 5000, 12000, 0.85, 0.65, 15000, 600, 4500,
          'Initial baseline policy v1.0 (cost ratio 25:1 false approval vs delay)', 'System Seed')`,
        [DEFAULT_ORG_IDS.RELIEF_DEMO],
      );
    }

    // 5. Seed Universal RAG Seed Documents
    const existingRag = await client.query(`SELECT COUNT(*)::int AS cnt FROM public.universal_rag_documents`);
    if (Number(existingRag.rows[0]?.cnt ?? 0) === 0) {
      await client.query(
        `INSERT INTO public.universal_rag_documents (organization_id, collection, language, title, content, tags, source)
         VALUES
           ($1, 'relief_policies_kb', 'en', 'Baseline Relief Eligibility v1.0', 'Households with monthly income up to 25,000 PKR may apply for MOCK_RELIEF_01. Amounts <= 5,000 PKR fast-track; <= 12,000 PKR require proof; above 12,000 PKR require human officer review.', ARRAY['eligibility','income','v1.0'], 'SEED_KB'),
           ($1, 'scam_fraud_kb', 'ur', '8171 جعلی پیغام سے بچاؤ', 'حقیقی 8171 امداد مفت ہے — کوئی فیس، OTP یا ایزی پیسہ پیسے مانگنے والا پیغام 100 فیصد فراڈ ہے۔', ARRAY['8171','scam','otp','fraud'], 'SEED_KB'),
           ($1, 'faq_guidance_kb', 'en', 'Document Quality & False-Alarm Protection', 'Blurry or dark rural phone photos are never auto-rejected as forged; citizens can retake or send for human officer verification.', ARRAY['document','blur','forgery'], 'SEED_KB')`,
        [DEFAULT_ORG_IDS.RELIEF_DEMO],
      );
    }

    console.log('[db:seed] Seeded 6 demo accounts, synthetic citizens, Rule v1.0, and Universal RAG collections into Supabase.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[db:seed] ERROR:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
