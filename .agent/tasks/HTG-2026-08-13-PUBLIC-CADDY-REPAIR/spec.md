# Task Spec

- Task ID: HTG-2026-08-13-PUBLIC-CADDY-REPAIR
- Title: Restore HappyTG public Mini App routing through shared Caddy
- Owner: HappyTG
- Mode: proof
- Status: frozen

## Problem

HappyTG Docker services were healthy, but the shared BaseDeploy Caddyfile no longer contained HappyTG routes, so public /miniapp returned HealthOS. The running Mini App image also emitted the internal browser API origin http://api:4000.

## Acceptance Criteria

1. Mini App runtime is rebuilt from current source and remains healthy
2. Shared Caddy routes only HappyTG paths and hostname to ports 3008, 4001, and 4100
3. Forced-local and public HTTPS checks return HappyTG identity without regressing Contacts, VideoCall, NPortal, or HealthOS

## Constraints

Do not expose broad /api/* publicly.
Preserve HealthOS fallback and existing Contacts, VideoCall, and NPortal routes.
Do not print or retain Telegram tokens or response bodies containing user data.

## Verification Plan

- Run Mini App unit tests, typecheck, and build.
- Validate and reload the shared Caddyfile under a frozen SHA256 guard with a rollback backup.
- Verify direct, forced-local, and public HTTPS identities and expected API status codes.
- Run pnpm happytg verify and a shared-neighbor public regression.

