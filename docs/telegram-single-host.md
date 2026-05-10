# Telegram single host

Telegram `getUpdates` must run from one BukowskiOS process only. If two Macs poll the same bot token, Telegram will deliver updates to whichever poller receives them first, so messages can look duplicated, delayed, or "stolen" by another machine.

## Runtime modes

- `BUKOWSKI_TELEGRAM_POLLING_MODE=host`: this process owns Telegram polling and processes incoming messages.
- `BUKOWSKI_TELEGRAM_POLLING_MODE=disabled`: this process stays passive. Use this for regular packaged desktop installs.
- `BUKOWSKI_TELEGRAM_POLLING_MODE=webhook`: alias for disabled in the desktop app. A separate hosted webhook should process updates.

Development builds default to `host` so local testing keeps working. Packaged builds default to `disabled` so Carlos/Ivan/etc. do not compete with the central host.

## Recommended setup

Run one always-on host for Telegram, either:

- a small remote webhook service, or
- one designated operations Mac running the app/dev process with `BUKOWSKI_TELEGRAM_POLLING_MODE=host`.

All other installed clients should remain in the default packaged mode or explicitly set `BUKOWSKI_TELEGRAM_POLLING_MODE=disabled`.
