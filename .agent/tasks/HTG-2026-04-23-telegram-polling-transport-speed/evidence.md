# Evidence

## Summary

The bottleneck is the polling/control-plane Node HTTPS attempt on this Windows host. Live direct calls to Telegram Bot API fail from Node after about 10.7 seconds with `UND_ERR_CONNECT_TIMEOUT`, while the Windows PowerShell Bot API path reaches Telegram. For long polling, the apparent 40-50 second gap is the sum of the Node connect timeout and Telegram long polling through PowerShell, not a local handler delay.

The fix adds:

- a Windows-only 1500 ms Node pre-fallback budget for short control-plane `telegramApiCall()` methods that already support PowerShell fallback;
- explicit PowerShell timeout budgets: 10 seconds for control-plane calls and `pollTimeoutSeconds + 10` for `getUpdates`;
- a short-lived polling transport preference so a successful PowerShell fallback prevents repeatedly trying a known-bad Node transport on every poll cycle;
- structured timing metadata on fallback logs.

`getUpdates` itself is not short-aborted because it is a healthy long-poll request on working Node transports. Fast polling fallback is reached by marking the transport preference after a bounded control-plane transport failure such as `deleteWebhook`, then using PowerShell for subsequent polling cycles while the preference is fresh.

## Live Timing

Artifacts:

- `raw/node-telegram-control-plane-timing.txt`
- `raw/powershell-telegram-control-plane-timing.txt`
- `raw/live-health.txt`

Measured on this host:

| Path | Result | Elapsed |
| --- | --- | ---: |
| Node `getUpdates` | `UND_ERR_CONNECT_TIMEOUT` | 10744.1 ms |
| Node `getWebhookInfo` | `UND_ERR_CONNECT_TIMEOUT` | 10667.8 ms |
| PowerShell `getUpdates` with Telegram `timeout=30`, `TimeoutSec=40` | success, 0 updates | 31813.3 ms |
| PowerShell `getWebhookInfo`, `TimeoutSec=40` | success | 4392.7 ms |

Local services were not running during this pass:

- `GET http://127.0.0.1:4000/health`: connection refused after 2188.9 ms
- `GET http://127.0.0.1:4100/health`: connection refused after 2046.7 ms
- `GET http://127.0.0.1:4100/ready`: connection refused after 2037.9 ms

The `/start` handler can reply without API calls when no host is paired. The `/pair` handler calls `POST /api/v1/pairing/claim`. Those paths were left unchanged.

## Before/After Synthetic Timing

Artifacts:

- `raw/polling-before-latency.txt`
- `raw/polling-after-latency.txt`
- `raw/start-command-before-after.txt`

Synthetic baseline used a 100 ms Node transport delay and a 20 ms PowerShell `getUpdates` delay to avoid waiting on real network timeouts in tests.

Before fix:

- elapsed for two fallback poll cycles: 402 ms;
- Node fetch order: `deleteWebhook`, `getUpdates`, `getUpdates`;
- every successful PowerShell fallback was preceded by a Node attempt.

After fix:

- elapsed for two fallback poll cycles: 114 ms;
- Node fetch order: `deleteWebhook`;
- `getUpdates` used cached PowerShell preference after `deleteWebhook` proved Node was unhealthy;
- PowerShell timeout budgets were explicit: `deleteWebhook=10`, `getUpdates=40`.
- regression coverage proves healthy Node `getUpdates` long polling is preserved and does not use the control-plane timeout.

For an inbound synthetic `/start` update already available at the start of a poll cycle:

- before model: 150 ms (`100 ms` Node delay + `20 ms` PowerShell `getUpdates` + `30 ms` send path);
- after measured: 60 ms;
- live projection: replace the synthetic 100 ms Node delay with this host's measured 10744.1 ms before-fix Node delay. Cached PowerShell polling removes that per-cycle Node delay after the first fallback.

## Explicit Questions

1. A Node HTTPS `getUpdates` attempt takes 10744.1 ms before failing on this host.
2. A successful PowerShell `getUpdates` fallback took 31813.3 ms with Telegram long polling set to 30 seconds.
3. Before the fix, yes. The synthetic baseline showed Node was tried before each `getUpdates` fallback. After the fix, polling caches a short PowerShell preference after fallback success.
4. The observed 40-50 second gaps are expected from Node timeout overhead plus Telegram long polling through PowerShell: about 10.7 seconds Node timeout plus about 31.8 seconds PowerShell long poll, with normal loop overhead. They are not caused by handler or retry delay when fallback succeeds.
5. `pollTimeoutSeconds` and PowerShell `Invoke-RestMethod -TimeoutSec` can interact badly if equal or too close. The fix makes `getUpdates` PowerShell timeout explicit as `pollTimeoutSeconds + 10`.
6. Yes. The bounded control-plane Node pre-fallback timeout removes about 9.2 seconds from startup/control-plane fallback on this host, and the transport preference removes the Node attempt entirely from subsequent poll cycles while preserving healthy Node long polling and Telegram API errors.
7. Synthetic `/start` update-to-reply timing improved from a 150 ms model to 60 ms measured. On this host, the material live improvement is removal of the measured 10744.1 ms Node `getUpdates` timeout from cached poll cycles.
8. When both transports fail, polling and `/ready` remain degraded with actionable detail. Regression coverage asserts the detail names Node HTTPS, the pre-fallback timeout, and the PowerShell failure message.

## Verification

- `pnpm --filter @happytg/bot run test`: passed, 43 tests.
- `pnpm --filter @happytg/bot run typecheck`: passed.
- `pnpm --filter @happytg/bot run build`: passed.
- `pnpm --filter @happytg/bot run lint`: passed.

Task validation and fresh verifier results are recorded separately.
