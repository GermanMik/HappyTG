import assert from "node:assert/strict";
import test from "node:test";

import type { PendingDispatch } from "../../../packages/protocol/src/index.js";

import {
  compactJournal,
  defaultWorkspaces,
  firstRunGuidance,
  hostNotPairedMessage,
  pairingInstructions,
  parseVerifierVerdict,
  sandboxForDispatch,
  shouldEmitStartupNotice,
  startupReadinessMessage,
  summarizeBootstrapReport
} from "./index.js";

function makeDispatch(overrides: Partial<PendingDispatch> = {}): PendingDispatch {
  return {
    id: "dsp_1",
    sessionId: "ses_1",
    hostId: "host_1",
    workspaceId: "ws_1",
    executionKind: "runtime_session",
    mode: "quick",
    runtime: "codex-cli",
    actionKind: "workspace_read",
    prompt: "inspect",
    title: "Inspect",
    status: "queued",
    idempotencyKey: "idem_1",
    createdAt: "2026-04-07T10:00:00.000Z",
    updatedAt: "2026-04-07T10:00:00.000Z",
    ...overrides
  };
}

test("defaultWorkspaces prefers configured workspace paths", () => {
  const workspaces = defaultWorkspaces(
    {
      ...process.env,
      HAPPYTG_WORKSPACES: "/tmp/alpha,/tmp/beta"
    },
    "/tmp/fallback"
  );

  assert.deepEqual(workspaces, [
    { path: "/tmp/alpha", repoName: "alpha" },
    { path: "/tmp/beta", repoName: "beta" }
  ]);
});

test("compactJournal keeps running entries and trims stale completed entries", () => {
  const journal = compactJournal(
    {
      entries: [
        {
          sessionId: "ses_running",
          dispatchId: "dsp_running",
          state: "running",
          lastUpdatedAt: "2026-04-07T10:00:00.000Z"
        },
        {
          sessionId: "ses_recent",
          dispatchId: "dsp_recent",
          state: "completed",
          lastUpdatedAt: "2026-04-07T09:59:59.000Z"
        },
        {
          sessionId: "ses_old",
          dispatchId: "dsp_old",
          state: "failed",
          lastUpdatedAt: "2026-04-06T09:00:00.000Z"
        }
      ]
    },
    {
      nowMs: new Date("2026-04-07T10:00:00.000Z").getTime(),
      retentionMs: 5_000
    }
  );

  assert.deepEqual(
    journal.entries.map((entry) => entry.dispatchId),
    ["dsp_running", "dsp_recent"]
  );
});

test("sandboxForDispatch preserves read-only safety for doctor and verify paths", () => {
  assert.equal(sandboxForDispatch(makeDispatch({ actionKind: "workspace_read" })), "read-only");
  assert.equal(sandboxForDispatch(makeDispatch({ actionKind: "verification_run" })), "read-only");
  assert.equal(sandboxForDispatch(makeDispatch({ actionKind: "workspace_write" })), "workspace-write");
});

test("parseVerifierVerdict keys off the first line only", () => {
  assert.equal(parseVerifierVerdict("VERDICT: PASS\nAll good"), "passed");
  assert.equal(parseVerifierVerdict("VERDICT: FAIL\nNeeds fixes"), "failed");
  assert.equal(parseVerifierVerdict("VERDICT: FAIL\nPASS later"), "failed");
});

test("startup guidance stays actionable and repeated notices are suppressed", () => {
  const cache = new Map<string, number>();

  assert.equal(
    startupReadinessMessage({ available: false }),
    "Codex CLI not found. Install Codex CLI, verify `codex --version`, then run `pnpm happytg doctor`."
  );
  assert.equal(
    firstRunGuidance({ hostId: undefined, readinessAvailable: false }),
    "Codex CLI not found. Install Codex CLI, verify `codex --version`, then run `pnpm happytg doctor`."
  );
  assert.equal(
    firstRunGuidance({ hostId: undefined, readinessAvailable: true }),
    "Host is not paired yet. Run `pnpm daemon:pair`, then send the code in Telegram with `/pair <CODE>`."
  );
  assert.equal(hostNotPairedMessage(), "Host is not paired yet. Run `pnpm daemon:pair`, then send the code in Telegram with `/pair <CODE>`.");
  assert.deepEqual(pairingInstructions("PAIR-123"), [
    "Pair with Telegram using: /pair PAIR-123",
    "Next: keep `pnpm dev` running, send the command in Telegram, then start the daemon with `pnpm dev:daemon`."
  ]);
  assert.equal(shouldEmitStartupNotice(cache, "codex", 0, 60_000), true);
  assert.equal(shouldEmitStartupNotice(cache, "codex", 1_000, 60_000), false);
  assert.equal(shouldEmitStartupNotice(cache, "codex", 61_000, 60_000), true);
});

test("summarizeBootstrapReport includes top finding codes", () => {
  const summary = summarizeBootstrapReport({
    id: "btr_1",
    hostFingerprint: "fp",
    command: "verify",
    status: "warn",
    profileRecommendation: "recommended",
    findings: [
      { code: "CODEX_SMOKE_WARNINGS", severity: "warn", message: "warning" },
      { code: "CODEX_CONFIG_MISSING", severity: "warn", message: "missing config" }
    ],
    planPreview: [],
    reportJson: {},
    createdAt: "2026-04-07T10:00:00.000Z"
  });

  assert.match(summary, /Bootstrap verify warn/);
  assert.match(summary, /CODEX_SMOKE_WARNINGS/);
  assert.match(summary, /CODEX_CONFIG_MISSING/);
});
