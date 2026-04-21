import assert from "node:assert/strict";
import test from "node:test";

import type { Policy } from "../../protocol/src/index.js";

import { evaluatePolicies } from "./index.js";

test("evaluatePolicies returns deny before lower-layer approval or allow", () => {
  const policies: Policy[] = [
    {
      id: "pol-global",
      layer: "global",
      scopeRef: "global",
      status: "active",
      version: 1,
      createdAt: new Date().toISOString(),
      rules: [
        {
          id: "deny-push",
          actionKind: "git_push",
          effect: "deny",
          reason: "Global policy blocks push"
        }
      ]
    },
    {
      id: "pol-session",
      layer: "session",
      scopeRef: "session-1",
      status: "active",
      version: 1,
      createdAt: new Date().toISOString(),
      rules: [
        {
          id: "allow-push",
          actionKind: "git_push",
          effect: "allow",
          reason: "Session would like to allow push"
        }
      ]
    }
  ];

  const decision = evaluatePolicies({
    actionKind: "git_push",
    scopeRefs: {
      global: "global",
      session: "session-1"
    },
    policies
  });

  assert.equal(decision.outcome, "deny");
  assert.equal(decision.effectiveLayer, "global");
  assert.match(decision.reason, /blocks push/i);
});

test("evaluatePolicies requires approval when no deny matches", () => {
  const decision = evaluatePolicies({
    actionKind: "workspace_write",
    scopeRefs: {
      global: "global"
    },
    policies: [
      {
        id: "pol-global",
        layer: "global",
        scopeRef: "global",
        status: "active",
        version: 1,
        createdAt: new Date().toISOString(),
        rules: [
          {
            id: "approve-write",
            actionKind: "workspace_write",
            effect: "require_approval",
            reason: "Writes need approval"
          }
        ]
      }
    ]
  });

  assert.equal(decision.outcome, "require_approval");
  assert.equal(decision.effectiveLayer, "global");
  assert.match(decision.reason, /approval/i);
});

test("evaluatePolicies ignores policies outside the requested scope", () => {
  const policies: Policy[] = [
    {
      id: "pol-global",
      layer: "global",
      scopeRef: "global",
      status: "active",
      version: 1,
      createdAt: new Date().toISOString(),
      rules: [
        {
          id: "allow-read",
          actionKind: "workspace_read",
          effect: "allow",
          reason: "Global read allow"
        }
      ]
    },
    {
      id: "pol-other-workspace",
      layer: "workspace",
      scopeRef: "ws_other",
      status: "active",
      version: 1,
      createdAt: new Date().toISOString(),
      rules: [
        {
          id: "deny-read",
          actionKind: "workspace_read",
          effect: "deny",
          reason: "Other workspace deny"
        }
      ]
    }
  ];

  const decision = evaluatePolicies({
    actionKind: "workspace_read",
    scopeRefs: {
      global: "global",
      workspace: "ws_current"
    },
    policies
  });

  assert.equal(decision.outcome, "allow");
  assert.equal(decision.matches.length, 1);
  assert.equal(decision.matches[0]?.policyId, "pol-global");
});
