'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { USER_ROLES, type UserRole } from '@awaaz/shared';
import { Building2, Pencil, Plus, ShieldAlert, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { ApiClientError, apiRequest } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/context';
import { formatText, useI18n } from '@/lib/i18n/context';
import { getRoleLandingRoute } from '@/lib/modules/registry';

interface WorkspaceMemberRow {
  user_id: string;
  email?: string;
  display_name: string;
  role: UserRole;
  department_id?: string | null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export default function WorkspacePage() {
  const { user, token, activeOrganizationId, switchWorkspace, refreshSession } = useAuth();
  const { dict, roleLabel } = useI18n();
  const [members, setMembers] = useState<WorkspaceMemberRow[]>([]);

  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgSlug, setNewOrgSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [editOrgName, setEditOrgName] = useState('');
  const [editOrgSlug, setEditOrgSlug] = useState('');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('officer');
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    if (!token || !activeOrganizationId || user?.active_role !== 'admin') return;
    try {
      const res = await apiRequest<{ members: WorkspaceMemberRow[] }>('/workspaces/current/members', {
        token,
        organizationId: activeOrganizationId,
      });
      setMembers(res.members);
    } catch {
      setMembers([]);
    }
  }, [token, activeOrganizationId, user?.active_role]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  if (!user) {
    return (
      <div className="rounded-xl bg-white border border-slate-200 p-8 text-center space-y-3">
        <p className="text-slate-700">{dict.workspace.signInPrompt}</p>
        <Link href="/login" className="inline-block px-5 py-2.5 rounded-xl bg-teal-700 text-white font-semibold">
          {dict.navLogin}
        </Link>
      </div>
    );
  }

  if (user.active_role !== 'admin') {
    return (
      <div className="max-w-lg mx-auto rounded-2xl bg-white border border-rose-200 p-8 text-center space-y-4">
        <ShieldAlert className="h-10 w-10 text-rose-600 mx-auto" />
        <h1 className="text-xl font-bold text-slate-900">{dict.admin.roleRequired}</h1>
        <p className="text-sm text-slate-600">{dict.workspace.subtitle}</p>
        <Link
          href={getRoleLandingRoute(user.active_role)}
          className="inline-block px-5 py-2.5 rounded-xl bg-teal-700 text-white font-semibold text-sm"
        >
          {formatText(dict.home.openRoleWorkspace, { role: roleLabel(user.active_role) })}
        </Link>
      </div>
    );
  }

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    const cleanSlug = slugify(newOrgSlug || newOrgName);
    if (cleanSlug.length < 3) {
      setErrorMsg('Workspace slug must be at least 3 lowercase letters, digits, or hyphens.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiRequest<{ workspace: { id: string; name: string } }>('/workspaces', {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: { name: newOrgName.trim(), slug: cleanSlug },
      });
      setNewOrgName('');
      setNewOrgSlug('');
      setSlugTouched(false);
      await switchWorkspace(res.workspace.id);
      setStatusMsg(formatText(dict.workspace.createdMsg, { name: res.workspace.name }));
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEditWorkspace = async (orgId: string) => {
    setErrorMsg(null);
    setStatusMsg(null);
    const cleanSlug = slugify(editOrgSlug);
    setBusy(true);
    try {
      const res = await apiRequest<{ workspace: { id: string; name: string } }>(`/workspaces/${orgId}`, {
        method: 'PATCH',
        token,
        organizationId: activeOrganizationId,
        body: { name: editOrgName.trim(), slug: cleanSlug },
      });
      setEditingOrgId(null);
      await refreshSession();
      setStatusMsg(formatText(dict.workspace.updatedMsg, { name: res.workspace.name }));
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteWorkspace = async (orgId: string) => {
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      const res = await apiRequest<{ deleted: boolean; fallback_organization_id: string }>(`/workspaces/${orgId}`, {
        method: 'DELETE',
        token,
        organizationId: activeOrganizationId,
      });
      if (orgId === user.active_organization.id) {
        await switchWorkspace(res.fallback_organization_id);
      } else {
        await refreshSession();
      }
      setStatusMsg(dict.workspace.deletedMsg);
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setBusy(false);
    }
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      await apiRequest('/workspaces/current/members', {
        method: 'POST',
        token,
        organizationId: activeOrganizationId,
        body: { email: inviteEmail.trim(), role: inviteRole },
      });
      setInviteEmail('');
      setStatusMsg(dict.workspace.memberUpdatedMsg);
      await loadMembers();
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveMember = async (targetUserId: string) => {
    setErrorMsg(null);
    setStatusMsg(null);
    setBusy(true);
    try {
      await apiRequest(`/workspaces/current/members/${targetUserId}`, {
        method: 'DELETE',
        token,
        organizationId: activeOrganizationId,
      });
      setStatusMsg(dict.workspace.memberRemovedMsg);
      await loadMembers();
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : dict.auth.authFailed);
    } finally {
      setBusy(false);
    }
  };

  const adminOrgCount = user.memberships.filter((m) => m.role === 'admin').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Building2 className="h-6 w-6 text-teal-700" />
          {dict.workspace.title}
        </h1>
        <p className="text-sm text-slate-600 mt-1">{dict.workspace.subtitle}</p>
      </div>

      {statusMsg && <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 text-sm">{statusMsg}</div>}
      {errorMsg && <div className="rounded-xl bg-rose-50 border border-rose-200 text-rose-900 px-4 py-3 text-sm">{errorMsg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Workspaces List + Edit + Delete + Create */}
        <div className="rounded-xl bg-white border border-slate-200 p-5 space-y-4">
          <h2 className="text-lg font-bold">{dict.workspace.yourWorkspaces}</h2>
          <div className="space-y-2.5">
            {user.memberships.map((m) => {
              const isActive = m.organization_id === user.active_organization.id;
              const isEditing = editingOrgId === m.organization_id;
              return (
                <div
                  key={m.organization_id}
                  className={`p-3 rounded-xl border space-y-2 ${
                    isActive ? 'border-teal-500 bg-teal-50/50' : 'border-slate-200'
                  }`}
                >
                  {isEditing ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={editOrgName}
                          onChange={(e) => setEditOrgName(e.target.value)}
                          placeholder={dict.workspace.workspaceNamePlaceholder}
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                        />
                        <input
                          type="text"
                          dir="ltr"
                          value={editOrgSlug}
                          onChange={(e) => setEditOrgSlug(e.target.value)}
                          placeholder={dict.workspace.workspaceSlugPlaceholder}
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleSaveEditWorkspace(m.organization_id)}
                          className="px-3 py-1 rounded-lg bg-teal-700 text-white text-xs font-semibold"
                        >
                          {dict.workspace.saveBtn}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingOrgId(null)}
                          className="px-3 py-1 rounded-lg border border-slate-300 text-xs font-semibold"
                        >
                          {dict.workspace.cancelBtn}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold text-slate-900">{m.organization_name}</div>
                        <div className="text-xs text-slate-500">
                          {dict.workspace.slugLabel}: <span dir="ltr">{m.organization_slug}</span> • {dict.workspace.roleLabel}: <strong>{roleLabel(m.role)}</strong>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {isActive ? (
                          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-teal-700 text-white">
                            {dict.active}
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void switchWorkspace(m.organization_id)}
                            className="px-3 py-1 rounded-lg border border-slate-300 text-xs font-semibold hover:bg-slate-100"
                          >
                            {dict.workspace.switchBtn}
                          </button>
                        )}
                        {m.role === 'admin' && (
                          <>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setEditingOrgId(m.organization_id);
                                setEditOrgName(m.organization_name);
                                setEditOrgSlug(m.organization_slug);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 text-xs font-semibold hover:bg-slate-100"
                            >
                              <Pencil className="h-3 w-3" /> {dict.workspace.editBtn}
                            </button>
                            {adminOrgCount > 1 && (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleDeleteWorkspace(m.organization_id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-100 text-rose-800 text-xs font-semibold hover:bg-rose-200"
                              >
                                <Trash2 className="h-3 w-3" /> {dict.workspace.deleteBtn}
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <form onSubmit={(e) => void handleCreateWorkspace(e)} className="pt-4 border-t border-slate-200 space-y-3">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <Plus className="h-4 w-4 text-teal-700" />
              {dict.workspace.createNewTitle}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                required
                minLength={3}
                placeholder={dict.workspace.workspaceNamePlaceholder}
                value={newOrgName}
                onChange={(e) => {
                  const val = e.target.value;
                  setNewOrgName(val);
                  if (!slugTouched) setNewOrgSlug(slugify(val));
                }}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="text"
                dir="ltr"
                required
                minLength={3}
                placeholder={dict.workspace.workspaceSlugPlaceholder}
                value={newOrgSlug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setNewOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
                }}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 rounded-lg bg-teal-700 text-white text-sm font-semibold hover:bg-teal-800 disabled:opacity-50"
            >
              {dict.workspace.createBtn}
            </button>
          </form>
        </div>

        {/* Active Workspace Members + Remove User + Add/Update Role */}
        <div className="rounded-xl bg-white border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">{dict.workspace.activeMembers}</h2>
            <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-medium">
              {dict.workspace.planLabel}: {user.active_organization.plan_tier}
            </span>
          </div>

          {members.length === 0 ? (
            <p className="text-sm text-slate-500">{dict.workspace.noMembers}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {members.map((m) => (
                <li key={m.user_id} className="py-2.5 flex items-center justify-between gap-2 text-sm">
                  <div>
                    <div className="font-medium text-slate-900">{m.display_name}</div>
                    {m.email && <div className="text-xs text-slate-500" dir="ltr">{m.email}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-800">
                      {roleLabel(m.role)}
                    </span>
                    {m.user_id !== user.id && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRemoveMember(m.user_id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-100 text-rose-800 text-xs font-semibold hover:bg-rose-200"
                      >
                        <UserMinus className="h-3.5 w-3.5" /> {dict.workspace.removeBtn}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={(e) => void handleInviteMember(e)} className="pt-4 border-t border-slate-200 space-y-3">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <UserPlus className="h-4 w-4 text-teal-700" />
              {dict.workspace.addMemberTitle}
            </h3>
            <div className="flex flex-wrap gap-2">
              <input
                type="email"
                dir="ltr"
                required
                placeholder={dict.workspace.memberEmailPlaceholder}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="flex-1 min-w-[180px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as UserRole)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {USER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-teal-700 text-white text-sm font-semibold disabled:opacity-50"
              >
                {dict.workspace.saveRoleBtn}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
