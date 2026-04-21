import type { Policy, PolicyDecision, PolicyEvaluationRequest, PolicyLayer, PolicyMatch, PolicyRule } from "../../protocol/src/index.js";

const LAYER_ORDER: PolicyLayer[] = ["global", "deployment", "workspace", "project", "session", "command"];

function findMatchingRules(policy: Policy, actionKind: PolicyRule["actionKind"]): PolicyMatch[] {
  return policy.rules
    .filter((rule) => rule.actionKind === actionKind)
    .map((rule) => ({
      policyId: policy.id,
      layer: policy.layer,
      ruleId: rule.id,
      effect: rule.effect,
      reason: rule.reason
    }));
}

function policyAppliesToScope(policy: Policy, request: PolicyEvaluationRequest): boolean {
  const requestedScope = request.scopeRefs[policy.layer];
  if (!requestedScope) {
    return policy.layer === "global" && policy.scopeRef === "global";
  }

  return policy.scopeRef === requestedScope;
}

export function evaluatePolicies(input: PolicyEvaluationRequest): PolicyDecision {
  const matches = input.policies
    .filter((policy) => policy.status === "active")
    .filter((policy) => policyAppliesToScope(policy, input))
    .flatMap((policy) => findMatchingRules(policy, input.actionKind))
    .sort((left, right) => LAYER_ORDER.indexOf(left.layer) - LAYER_ORDER.indexOf(right.layer));

  const deny = matches.find((match) => match.effect === "deny");
  if (deny) {
    return {
      outcome: "deny",
      effectiveLayer: deny.layer,
      matches,
      reason: deny.reason
    };
  }

  const requireApproval = matches.find((match) => match.effect === "require_approval");
  if (requireApproval) {
    return {
      outcome: "require_approval",
      effectiveLayer: requireApproval.layer,
      matches,
      reason: requireApproval.reason
    };
  }

  return {
    outcome: "allow",
    effectiveLayer: matches[0]?.layer ?? "global",
    matches,
    reason: matches[0]?.reason ?? "No matching deny or approval rule"
  };
}

export function createDefaultPolicies(): Policy[] {
  return [
    {
      id: "pol_global_default",
      layer: "global",
      scopeRef: "global",
      status: "active",
      version: 1,
      createdAt: new Date().toISOString(),
      rules: [
        {
          id: "rule_allow_status",
          actionKind: "read_status",
          effect: "allow",
          reason: "Fast-path host and session status checks are allowed"
        },
        {
          id: "rule_allow_workspace_read",
          actionKind: "workspace_read",
          effect: "allow",
          reason: "Read-only workspace inspection is allowed"
        },
        {
          id: "rule_require_workspace_write",
          actionKind: "workspace_write",
          effect: "require_approval",
          reason: "Workspace mutations require explicit approval"
        },
        {
          id: "rule_require_outside_root_write",
          actionKind: "workspace_write_outside_root",
          effect: "require_approval",
          reason: "Out-of-root writes require explicit approval"
        },
        {
          id: "rule_require_git_push",
          actionKind: "git_push",
          effect: "require_approval",
          reason: "Git push is a risky mutation"
        },
        {
          id: "rule_require_bootstrap_install",
          actionKind: "bootstrap_install",
          effect: "require_approval",
          reason: "Installing packages changes host state"
        },
        {
          id: "rule_require_bootstrap_edit",
          actionKind: "bootstrap_config_edit",
          effect: "require_approval",
          reason: "Config edits require explicit approval"
        },
        {
          id: "rule_allow_pair",
          actionKind: "daemon_pair",
          effect: "allow",
          reason: "Pairing is allowed with short-lived registration codes"
        },
        {
          id: "rule_allow_resume",
          actionKind: "session_resume",
          effect: "allow",
          reason: "Resume attempts are allowed and revalidated server-side"
        },
        {
          id: "rule_allow_verify",
          actionKind: "verification_run",
          effect: "allow",
          reason: "Verification is allowed because it should be read-focused"
        }
      ]
    }
  ];
}
