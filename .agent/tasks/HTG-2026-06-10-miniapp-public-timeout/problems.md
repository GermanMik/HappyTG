# Problems

## Remaining external issue

The default no-port route `https://happytg.gerta.crazedns.ru/miniapp` still is not the browser-safe launch target. It was reachable by `curl`, but Chromium rejected it with `ERR_SSL_PROTOCOL_ERROR` during investigation. The working Telegram/WebView URL is:

```text
https://happytg.gerta.crazedns.ru:5083/miniapp
```

## Warning not fixed in this task

`pnpm happytg doctor` and `pnpm happytg verify` both report one warning from Codex CLI memory DB startup. This is unrelated to HappyTG routing, Caddy, Telegram menu setup, or the Mini App public URL.

