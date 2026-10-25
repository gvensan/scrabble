# Primary references and checks (reviewed 2026-10-25)

1. Cloudflare Durable Objects overview: https://developers.cloudflare.com/durable-objects/
2. Cloudflare DO free-tier pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/
3. Cloudflare DO limits: https://developers.cloudflare.com/durable-objects/platform/limits/
4. Cloudflare WebSocket hibernation: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
5. Cloudflare alarms: https://developers.cloudflare.com/durable-objects/api/alarms/
6. GitHub Pages custom workflows: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
7. WordSoHard provider overview: https://wordsohard.com/api
8. WordSoHard examples and OpenAPI reference: https://github.com/Kumar-Media-LLC/wordsohard-api-examples
9. WordSoHard OpenAPI candidate: https://wordsohard.com/openapi.json

## Confirmed from primary documentation
- SQLite-backed Durable Objects are supported on Workers Free.
- Cloudflare's listed free DO allowance includes 100,000 requests/day, 13,000 GB-seconds/day and 5 GB SQLite storage/account. Limits can change and free plan operations fail when certain quotas are exhausted.
- WordSoHard's published example `GET /api/v1/define/{word}` returns `found` and `scrabble.valid` separately and identifies lexicon as non-official; attribution requested and fair-use guidance approximately 60 requests/minute/IP.
- GitHub Pages supports GitHub Actions deployment of compiled static assets.

## Verify before deploy
- Live WordSoHard endpoint schema and any advertised batch API. NEVER assume an undocumented `/api/v1/check/...` route works.
- WordSoHard licensing/attribution for application UI; display credits as required.
- Dictionary edge words; API response errors and uptime behavior.
- Cloudflare current per-request and storage limits, free-plan room behavior, Worker quotas and Cloudflare account configuration.
- Game's original branding and word-list/copyright considerations.
