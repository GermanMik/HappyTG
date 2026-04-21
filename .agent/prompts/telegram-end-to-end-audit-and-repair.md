# Telegram End-to-End Audit And Repair Prompt

Use this prompt when HappyTG Telegram interaction is flaky, silent, or slow, and you need a proof-loop investigation that both diagnoses and fixes the real bottleneck.

## Prompt

You are working in the HappyTG repository at `C:\Develop\Projects\HappyTG`.

Your task is to perform a full end-to-end audit, diagnosis, and bounded repair of HappyTG's Telegram interaction path, with special attention to response latency.

Follow the repository proof-loop discipline strictly:

1. Create a canonical proof bundle under `.agent/tasks/<TASK_ID>/` with:
   - `spec.md`
   - `evidence.md`
   - `evidence.json`
   - `verdict.json`
   - `problems.md`
   - `task.json`
   - `raw/build.txt`
   - `raw/test-unit.txt`
   - `raw/test-integration.txt`
   - `raw/lint.txt`
2. Freeze scope before production edits.
3. Builder and verifier roles must stay separate.
4. Do not self-certify without a fresh verification pass.

## Current Known Context

- This repo already has:
  - local-dev polling support instead of webhook-only behavior;
  - Windows PowerShell fallback for Telegram Bot API polling/webhook inspection;
  - a poison-update fix so one failing `/pair` update no longer blocks later `/start`.
- On this machine, current live measurements already show:
  - `GET http://127.0.0.1:4000/health` is about `104 ms`;
  - `GET http://127.0.0.1:4100/health` is about `44 ms`;
  - `GET http://127.0.0.1:4100/ready` is about `267 ms`;
  - direct Node HTTPS `getMe` to Telegram takes about `10.7 s` and fails with `UND_ERR_CONNECT_TIMEOUT`;
  - direct PowerShell `getMe` to Telegram succeeds in about `0.4 s`.
- That strongly suggests the remaining "Telegram replies are slow" symptom is likely in the outbound Bot API transport path, especially `sendMessage`, not in the local API or bot readiness endpoints.
- Do not assume this hypothesis is correct. Prove or falsify it with repo-local evidence.

## Goal

Determine why Telegram replies are slow or inconsistent, then implement the minimum bounded fix that restores both correctness and acceptable response latency without weakening auth, pairing, approval, or delivery-mode semantics.

## Required Investigation Scope

Audit the entire Telegram path:

1. Inbound update delivery
   - delivery mode resolution (`auto|polling|webhook`);
   - polling loop behavior;
   - webhook handler path;
   - stale or poison update replay behavior.

2. Bot command execution
   - `/start`
   - `/pair`
   - any API fetches the bot does before replying
   - handler failures that can delay or suppress replies

3. Outbound Telegram reply path
   - `sendMessage` latency
   - Node HTTPS path
   - Windows PowerShell fallback path
   - whether fallback is attempted only after a long Node timeout
   - whether fallback should be parallelized, shortened by timeout, or selected earlier on this host

4. Local service latency
   - `api /health`
   - `bot /health`
   - `bot /ready`
   - any internal API call involved in `/start` and `/pair`

## Explicit Questions To Answer

Your evidence must answer all of these:

1. Is the current slowness caused by:
   - Telegram inbound delivery,
   - bot handler logic,
   - local API latency,
   - Telegram outbound `sendMessage`,
   - or a combination?
2. If outbound Telegram delivery is slow, how much time is spent in:
   - Node HTTPS attempt,
   - fallback transition,
   - Windows PowerShell Bot API call?
3. Does the current `sendMessage` path wait for the full Node transport timeout before fallback?
4. Can the response path be made materially faster with a bounded fix while preserving truthful failure handling?
5. What is the measured before/after latency for a Telegram reply after the fix?

## Constraints

- Keep the explicit Telegram delivery-mode model intact.
- Do not silently change explicit webhook mode into polling.
- Do not weaken `/api/v1/pairing/claim`, approval resolution, or user-binding boundaries.
- Do not redesign the whole Telegram subsystem.
- Prefer a minimal fix in the bot transport/runtime path if the main bottleneck is there.
- Preserve truthful logs and `/ready` output.

## Recommended Evidence To Capture

Add concrete artifacts such as:

- `raw/live-health.txt`
- `raw/live-ready.txt`
- `raw/node-getme-timing.txt`
- `raw/powershell-getme-timing.txt`
- `raw/sendmessage-node-timing.txt`
- `raw/sendmessage-fallback-timing.txt`
- `raw/webhook-smoke.txt`
- `raw/polling-smoke.txt`
- `raw/before-latency.txt`
- `raw/after-latency.txt`
- `raw/test-unit.txt`
- `raw/test-integration.txt`
- `raw/typecheck.txt`
- `raw/build.txt`
- `raw/lint.txt`
- `raw/task-validate.txt`

## Expected Fix Shape

If the main issue is outbound Telegram latency on Windows, inspect `apps/bot/src/index.ts`, especially:

- `createDefaultSendTelegramMessage()`
- `telegramApiCall()`
- Windows PowerShell fallback helpers

Potential bounded fixes may include:

- a short explicit timeout for Node `sendMessage` before fallback;
- racing Node HTTPS and PowerShell fallback safely on this host;
- host/platform-specific transport preference when Node HTTPS is already proven unhealthy;
- more precise latency-aware retry/fallback behavior.

Only implement the option you can defend with evidence and regression coverage.

## Verification Requirements

At minimum run and record:

- `pnpm --filter @happytg/bot run test`
- `pnpm --filter @happytg/bot run typecheck`
- `pnpm --filter @happytg/bot run build`
- `pnpm --filter @happytg/bot run lint`
- `pnpm happytg task validate --repo . --task <TASK_ID>`

If you change cross-package behavior, expand verification accordingly.

## Completion Criteria

Do not mark complete until the proof bundle demonstrates:

1. the real latency bottleneck is identified;
2. the fix is bounded and justified;
3. regression coverage exists for the latency or transport failure mode you fixed;
4. local verification is green;
5. live or near-live measurements show improved reply behavior or clearly explain why no product fix was appropriate.
