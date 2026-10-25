# Milestone 0 assumption verification

Verified against primary sources on 2026-10-25. Platform terms and quotas remain time-sensitive and must be checked again before deployment.

## Cloudflare Durable Objects

- Workers Free can create and access SQLite-backed Durable Objects.
- The published Free allowance showed 100,000 requests/day, 13,000 GB-s/day, and 5 GB total SQLite storage. Free does not mean unlimited or permanently zero-cost at arbitrary scale.
- The Hibernation WebSocket API permits an object to sleep without disconnecting clients. Socket attachments can restore connection metadata after reinitialization.
- A Durable Object has one scheduled alarm at a time. Alarm execution is at least once, so handlers must be idempotent and persisted state must determine what remains due.

Primary sources:

- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- https://developers.cloudflare.com/durable-objects/api/alarms/

## GitHub Pages and Actions

- GitHub Pages supports custom Actions workflows using `configure-pages`, `upload-pages-artifact`, and `deploy-pages`.
- Repository and environment secrets are supported. Non-`GITHUB_TOKEN` secrets are not sent to workflows triggered from forks.
- A future deployment workflow will use GitHub's `pages` environment and minimal job permissions. Deployment is deliberately deferred to Milestone 4.

Primary sources:

- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets

## WordSoHard

- `https://wordsohard.com/openapi.json` was reachable and identified version 1.1.0.
- The documented batch check endpoint accepts 1–20 comma-separated words, each 2–30 letters.
- Live define probes: `qi`, `quiz`, `cats`, `at`, and `cat` returned `scrabble.valid: true`; `zzqzx` returned false.
- A live batch probe of `qi,quiz,zzqzx,cats,at` returned matching validity and `allValid: false`.
- The contract distinguishes definition `found` from legality and requires provider attribution.
- The provider describes the list as its own approximately 257,000-word list derived from public-domain sources, not an official tournament lexicon.
- The published fair-use guidance is approximately 60 requests/minute/IP. Cloudflare egress behavior means the application still needs conservative server-side budgeting and backoff.

Primary sources:

- https://wordsohard.com/api
- https://wordsohard.com/openapi.json
- https://wordsohard.com/terms

## Remaining release checks

- Reconfirm all quotas, action versions, provider schema, terms, and attribution immediately before their implementation/deployment milestones.
- Run a legal/brand review of the final Scrabble name, visual identity, baseline letter distribution, and premium layout.
- Confirm the eventual GitHub repository/project slug before fixing Vite's production base path.
