# Security Policy

SuperCharts is a local-first trading terminal with optional provider keys and automation bridges. Treat all credentials and account identifiers as sensitive.

## Do Not Commit

- `.env`, `.env.local`, or any provider-specific secret files
- SQLite databases under `apps/api/data/`
- Telegram bot tokens, chat IDs, webhook tokens, OANDA tokens, Stripe keys, MT5 credentials, or tunnel credentials
- Screenshots that reveal private account, broker, or billing details

## Reporting

If you find a security issue, do not open a public issue containing exploit details. Contact the maintainer privately and include:

- affected component
- reproduction steps
- expected impact
- suggested mitigation, if known

## Deployment Notes

- Do not expose the API to the public internet without real auth and rate limiting.
- Use `DEMO_MODE=1` for public demos of a local machine.
- Keep Telegram, OANDA, Stripe, and MT5 credentials server-side only.
- Rotate credentials immediately if they were exposed in logs, screenshots, commits, or public URLs.
