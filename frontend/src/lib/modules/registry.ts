import type { UserRole } from '@awaaz/shared';

export interface FrontendFeatureModule {
  id: string;
  name: string;
  description: string;
  entryRoutes: Partial<Record<UserRole, string>>;
  defaultRoute: string;
  status: 'active';
}

/**
 * Frontend Module Registry.
 * Idea 1 (Relief Assistance) is active today.
 * Future Ideas 2 and 3 can be registered here as independent entries
 * without modifying Idea 1 or the shared SaaS shell.
 */
export const FRONTEND_MODULES: FrontendFeatureModule[] = [
  {
    id: 'relief-assistance',
    name: 'Mock Relief-Assistance Application',
    description:
      'Multilingual, voice-first guided application wizard with document checks, grounded policy Q&A, deterministic eligibility rules, and officer review.',
    entryRoutes: {
      citizen: '/citizen',
      helper: '/helper',
      officer: '/officer',
      admin: '/admin',
    },
    defaultRoute: '/citizen',
    status: 'active',
  },
];

export function getRoleLandingRoute(role: UserRole): string {
  return FRONTEND_MODULES[0]?.entryRoutes[role] ?? '/';
}
