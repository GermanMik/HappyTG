import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { FileStateStore } from "../../../packages/shared/src/index.js";

import { HappyTGControlPlaneService } from "./service.js";

async function createServiceWithTempStore() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "happytg-api-test-"));
  const storePath = path.join(tempDir, "control-plane.json");
  return {
    tempDir,
    service: new HappyTGControlPlaneService(new FileStateStore(storePath))
  };
}

test("proof session creates task bundle and approval, then approval dispatches session", async () => {
  const { tempDir, service } = await createServiceWithTempStore();
  const workspaceDir = await mkdtemp(path.join(tempDir, "workspace-"));

  const pairing = await service.startPairing({
    hostLabel: "test-host",
    fingerprint: "fp-1"
  });

  const claim = await service.claimPairing({
    pairingCode: pairing.pairingCode,
    telegramUserId: "1001",
    chatId: "2001",
    displayName: "Test User"
  });

  const hello = await service.hostHello({
    hostId: pairing.hostId,
    fingerprint: "fp-1",
    capabilities: ["codex-cli"],
    workspaces: [
      {
        path: workspaceDir,
        repoName: "workspace"
      }
    ]
  });

  const sessionResult = await service.createSession({
    userId: claim.user.id,
    hostId: pairing.hostId,
    workspaceId: hello.workspaces[0]!.id,
    mode: "proof",
    runtime: "codex-cli",
    title: "proof",
    prompt: "proof prompt",
    acceptanceCriteria: ["criterion"]
  });

  assert.equal(sessionResult.session.state, "awaiting_approval");
  assert.ok(sessionResult.approval);
  assert.ok(sessionResult.task);

  const resolved = await service.resolveApproval(sessionResult.approval!.id, {
    userId: claim.user.id,
    decision: "approved"
  });

  assert.equal(resolved.session.state, "pending_dispatch");
  assert.ok(resolved.dispatch);
});

test("quick session dispatches immediately without approval", async () => {
  const { tempDir, service } = await createServiceWithTempStore();
  const workspaceDir = await mkdtemp(path.join(tempDir, "workspace-"));

  const pairing = await service.startPairing({
    hostLabel: "test-host",
    fingerprint: "fp-2"
  });

  const claim = await service.claimPairing({
    pairingCode: pairing.pairingCode,
    telegramUserId: "1002",
    chatId: "2002",
    displayName: "Test User"
  });

  const hello = await service.hostHello({
    hostId: pairing.hostId,
    fingerprint: "fp-2",
    capabilities: ["codex-cli"],
    workspaces: [
      {
        path: workspaceDir,
        repoName: "workspace"
      }
    ]
  });

  const sessionResult = await service.createSession({
    userId: claim.user.id,
    hostId: pairing.hostId,
    workspaceId: hello.workspaces[0]!.id,
    mode: "quick",
    runtime: "codex-cli",
    title: "quick",
    prompt: "read only"
  });

  assert.equal(sessionResult.session.state, "pending_dispatch");
  assert.ok(sessionResult.dispatch);
  assert.equal(sessionResult.approval, undefined);
});
