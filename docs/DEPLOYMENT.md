# Deployment

Scrabble uses GitHub Pages for the static web client and a Cloudflare Worker with SQLite-backed Durable Objects for rooms. No credential is committed or compiled into the browser.

## GitHub configuration

Create a `production` environment and configure:

- Secret `CLOUDFLARE_API_TOKEN`: narrowly scoped Worker/Durable Object deployment token.
- Secret `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account identifier, kept in the secret store by project policy.
- Variable `ALLOWED_ORIGINS`: exact GitHub Pages origin, for example `https://OWNER.github.io`.
- Variable `VITE_API_BASE_URL`: deployed Worker HTTPS origin.
- Variable `VITE_WS_BASE_URL`: deployed Worker WSS origin.
- Secret `RATE_LIMIT_SALT`: a generated random value used to pseudonymize admission-rate keys.
- Secret `ADMIN_TOKEN`: at least 24 random characters; unlocks `#/adminit`. The Worker workflow refuses to deploy without it.
- Variable `ROOM_CREATE_LIMIT` (optional): rooms one network may create per hour, default 10.
- Variables `WORKER_DEPLOY_ENABLED` and `PAGES_DEPLOY_ENABLED`: set each to `true` only after its required values are configured. This keeps initial repository pushes green instead of publishing a half-configured app.

The Worker workflow transfers `RATE_LIMIT_SALT` from GitHub Secrets into Cloudflare's encrypted Worker-secret store. It is used only to pseudonymize admission-rate keys and must not be a `VITE_*` value.

Enable GitHub Pages with **GitHub Actions** as its source. The workflows in `.github/workflows/pages.yml` and `worker.yml` run the complete quality gate before deployment. They use the current official GitHub Pages actions and Cloudflare Wrangler action.

Deploy the Worker first, set its returned URL in the two public `VITE_*` variables, then dispatch the Pages workflow. `VITE_*` values are public bundle configuration and must never contain credentials.

## Local development

```sh
cp .env.example .env
cp .dev.vars.example apps/worker/.dev.vars
npm install
npx --yes wrangler@4.61.1 dev --local --config apps/worker/wrangler.jsonc
npm run dev
```

Wrangler is intentionally not locked as an application dependency because currently available releases had security-advisory conflicts during verification. Re-evaluate the current release before production deployment and update the pinned one-off version above.

## Deployment smoke test

1. Check `/health` returns `{ "ok": true }`.
2. Open two private/incognito browser contexts on different devices.
3. Create, join, ready, start, play, refresh/rejoin, disconnect/reconnect, exchange, pass, and finish a game.
4. Confirm each client sees only its own rack in WebSocket frames.
5. Confirm WordSoHard attribution is visible and an API outage rejects without committing.
6. Confirm an expired room code cannot resolve.

Actual deployment requires the repository remote and the two Cloudflare secrets; do not paste them into files or chat logs.
