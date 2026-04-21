# HappyTG Security Hardening

## Trust Boundaries

- Telegram client is not trusted.
- Mini App frontend is not trusted.
- host daemon is not trusted by default until paired and heartbeat-validated.
- verifier is not trusted as builder.
- `startapp` payload is a launch hint, not authentication.

## Defaults

- Dangerous deploy/publish/external side effects are denied in MVP policy.
- Approval callbacks carry nonce and are idempotent.
- Mini App launch grants are signed, short-lived, use-limited, and revocable.
- Mini App sessions are short-lived, token-hashed in store, and revocable.
- Logger metadata redacts token, secret, password, authorization, API key, and signing key fields.

## Always Require Explicit Approval

- workspace writes
- writes outside workspace root
- shell/network/system-sensitive actions
- git push
- bootstrap config edits that affect runtime trust
- deploy/publish/external side effects if enabled beyond MVP

## Auto-Allow Candidates

- status reads
- workspace read inspection
- health/ready/version/metrics checks
- verification runs that are read-focused
- resume attempts after policy revalidation

## Forbidden In MVP

- unattended deploy/publish
- live migrations from agent sessions
- secret exfiltration into prompts, logs, proof bundles, or Telegram messages
- parallel mutating tool execution
- using Telegram as internal agent event transport

## Rotation And Revocation

- Rotate `TELEGRAM_BOT_TOKEN` through BotFather and restart bot.
- Rotate `JWT_SIGNING_KEY` and `HAPPYTG_MINIAPP_LAUNCH_SECRET` during a maintenance window.
- Revoke Mini App sessions via `/api/v1/miniapp/auth/session/:id/revoke`.
- Revoke launch grants via `/api/v1/miniapp/launch-grants/:id/revoke`.
- Re-pair suspicious hosts and preserve audit records.

## Audit Checklist

- Every approval request has an approval decision or expiry.
- Every risky dispatch references an approval or deny reason.
- Every host pairing links fingerprint, Telegram identity, user, and timestamp.
- Every proof task has repo-local evidence and verifier verdict.
- Logs do not contain raw tokens or secrets.
