import type {
  EligibilityRuleDefinition,
  EligibilityRuleRecord,
  RuleVersionRecord,
  UserRole,
} from '@awaaz/shared';
import type { AuditService } from '../../../core/audit/audit-service';
import type { AuthContext } from '../../../core/auth/auth-service';
import type { DataStore } from '../../../core/database/types';
import { AppError } from '../../../core/security/errors';

export class AdminService {
  constructor(
    private readonly store: DataStore,
    private readonly audit: AuditService,
  ) {}

  async listRulesWithActiveVersion(auth: AuthContext): Promise<
    Array<{
      rule: EligibilityRuleRecord;
      active_version: RuleVersionRecord | null;
      versions_count: number;
    }>
  > {
    const rules = await this.store.listRules(auth.organizationId);
    const result = [];
    for (const rule of rules) {
      const versions = await this.store.listRuleVersions(auth.organizationId, rule.id);
      const activeVersion = rule.active_version_id
        ? (versions.find((v) => v.id === rule.active_version_id) ?? null)
        : null;
      result.push({
        rule,
        active_version: activeVersion,
        versions_count: versions.length,
      });
    }
    return result;
  }

  async createOrUpdateSchemeRuleVersion(
    auth: AuthContext,
    definition: EligibilityRuleDefinition,
  ): Promise<{ rule: EligibilityRuleRecord; version: RuleVersionRecord }> {
    let rule = await this.store.getRuleByScheme(auth.organizationId, definition.scheme_id);
    if (!rule) {
      rule = await this.store.createRule(auth.organizationId, definition.scheme_id);
    }
    const existingVersions = await this.store.listRuleVersions(auth.organizationId, rule.id);
    const nextVersionNumber = (existingVersions[0]?.version_number ?? 0) + 1;

    const version = await this.store.createRuleVersion({
      organization_id: auth.organizationId,
      rule_id: rule.id,
      scheme_id: definition.scheme_id,
      version_number: nextVersionNumber,
      rules_json: definition,
      published_by: auth.userId,
    });

    // Publish immediately or keep explicit publish route available
    const updatedRule = await this.store.setRuleActiveVersion(auth.organizationId, rule.id, version.id);

    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'rule_version.published',
      resourceType: 'rule_version',
      resourceId: version.id,
      metadata: {
        rule_id: rule.id,
        scheme_id: definition.scheme_id,
        version_number: version.version_number,
      },
    });

    return { rule: updatedRule, version };
  }

  async publishExistingRuleVersion(
    auth: AuthContext,
    ruleId: string,
    versionId?: string,
  ): Promise<{ rule: EligibilityRuleRecord; active_version: RuleVersionRecord }> {
    const rule = await this.store.getRuleById(auth.organizationId, ruleId);
    if (!rule) throw new AppError(404, 'RULE_NOT_FOUND', 'Rule not found.');

    const versions = await this.store.listRuleVersions(auth.organizationId, rule.id);
    const target = versionId
      ? versions.find((v) => v.id === versionId)
      : versions[0];
    if (!target) throw new AppError(404, 'RULE_VERSION_NOT_FOUND', 'No rule version available to publish.');

    const updated = await this.store.setRuleActiveVersion(auth.organizationId, rule.id, target.id);

    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'rule.active_version_switched',
      resourceType: 'eligibility_rule',
      resourceId: rule.id,
      metadata: { active_version_id: target.id, version_number: target.version_number },
    });

    return { rule: updated, active_version: target };
  }

  async listRuleVersionsWithCaseCounts(
    auth: AuthContext,
    ruleId: string,
  ): Promise<Array<RuleVersionRecord & { cases_evaluated_count: number }>> {
    const versions = await this.store.listRuleVersions(auth.organizationId, ruleId);
    const cases = await this.store.listCases(auth.organizationId);
    return versions.map((v) => ({
      ...v,
      cases_evaluated_count: cases.filter((c) => c.rule_version_id === v.id).length,
    }));
  }

  async updateMemberRole(
    auth: AuthContext,
    input: { user_id: string; role: UserRole; department_id?: string | null },
  ) {
    const profile = await this.store.getProfileById(input.user_id);
    if (!profile) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');

    const updated = await this.store.upsertMembership({
      organization_id: auth.organizationId,
      user_id: input.user_id,
      role: input.role,
      department_id: input.department_id ?? null,
    });

    await this.audit.log({
      organizationId: auth.organizationId,
      actorId: auth.userId,
      action: 'workspace_member.role_updated',
      resourceType: 'organization_membership',
      resourceId: updated.id,
      metadata: { target_user_id: input.user_id, new_role: input.role },
    });

    return updated;
  }

  async getOperationalMetrics(auth: AuthContext) {
    const [cases, members, rules, policies, aiRuns] = await Promise.all([
      this.store.listCases(auth.organizationId),
      this.store.listOrganizationMembers(auth.organizationId),
      this.store.listRules(auth.organizationId),
      this.store.listPolicies(auth.organizationId),
      this.store.listAiRuns(auth.organizationId),
    ]);

    const casesByStatus: Record<string, number> = {};
    for (const c of cases) {
      casesByStatus[c.status] = (casesByStatus[c.status] ?? 0) + 1;
    }

    return {
      organization_id: auth.organizationId,
      total_cases: cases.length,
      cases_by_status: casesByStatus,
      total_members: members.length,
      total_rules: rules.length,
      total_policies: policies.length,
      total_ai_runs: aiRuns.length,
    };
  }
}
