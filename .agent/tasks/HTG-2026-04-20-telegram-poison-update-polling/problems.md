# Problems

- No remaining blocking repo bug was found in Telegram transport selection for this task; the blocking issue was poisoned update replay inside polling.
- The API error shape for expired pairing codes is still not ideal (`500`), but that is outside this bounded bot-runtime fix.
