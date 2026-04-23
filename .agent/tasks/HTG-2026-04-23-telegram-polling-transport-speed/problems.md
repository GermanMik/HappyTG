# Problems

- Local API and bot services were not running during live health probing, so local service latency was recorded as connection refused rather than as healthy response timing. The code change did not touch local API paths.
- No private Telegram chat content was recorded. Live Bot API timings were sanitized to method/status/timing/counts only.
