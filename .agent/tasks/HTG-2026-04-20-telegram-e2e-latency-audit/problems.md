# Problems

- `telegramApiCall()` still uses the default Node transport timeout before Windows fallback on control-plane calls such as `deleteWebhook` and `getWebhookInfo`. Current evidence shows that is not the user-visible reply bottleneck, so widening the fix into that path was intentionally left out of scope.
- Windows PowerShell fallback currently surfaces a generic `400 Bad Request` string for the synthetic invalid-chat `sendMessage` probes on this host rather than a richer Telegram JSON description.
- An already-running bot process must reload before live traffic on that process benefits from the new bounded timeout.
