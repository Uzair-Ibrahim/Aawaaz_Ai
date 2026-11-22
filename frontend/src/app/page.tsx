'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { AwaazLogo } from '@/components/shared/AwaazLogo';
import { useAuth } from '@/lib/auth/context';
import { formatText, useI18n } from '@/lib/i18n/context';
import { getRoleLandingRoute } from '@/lib/modules/registry';

export default function HomePage() {
  const { user } = useAuth();
  const { dict, roleLabel } = useI18n();

  const isStaff = user?.active_role === 'officer' || user?.active_role === 'admin';

  // Staff roles (Officer / Admin) see a crisp, zero-voice portal redirect card — zero TTS/mic/overlay!
  if (isStaff && user) {
    return (
      <div className="max-w-2xl mx-auto py-10">
        <section className="rounded-3xl bg-white/95 backdrop-blur-xs border-2 border-blue-200/90 p-8 shadow-md text-center space-y-5">
          <div className="flex justify-center">
            <AwaazLogo size="lg" />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-950">
            {user.display_name} ({roleLabel(user.active_role)})
          </h1>
          <Link
            href={getRoleLandingRoute(user.active_role)}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-extrabold shadow-sm transition"
          >
            <span>{formatText(dict.home.openRoleWorkspace, { role: roleLabel(user.active_role) })}</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>
    );
  }

  // Non-staff citizens use the single persistent VoiceSaathiOverlay hosted in AppShell
  // so navigating / -> /signup -> /login -> /citizen NEVER unmounts or swaps the Voice UI!
  return null;
}
