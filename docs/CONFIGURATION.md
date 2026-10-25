# Configuration and secrets

## Policy

- Commit no credentials, access tokens, private room/session tokens, or production secrets.
- Local browser configuration goes in `.env`; local Worker-only secrets will go in `.dev.vars`. Both are ignored by Git.
- `.env.example` contains names and safe examples only.
- Variables beginning with `VITE_` are compiled into the public browser bundle and **must never contain secrets**.
- GitHub-hosted workflows receive sensitive deployment values through GitHub repository or environment secrets. Production Worker secrets are stored with Cloudflare's secret configuration, not in source or Wrangler configuration.
- Workflows must use the narrowest permissions possible and must not echo secret values.

## Planned environments

| Environment       | Browser configuration             | Server secrets                                                            |
| ----------------- | --------------------------------- | ------------------------------------------------------------------------- |
| Local             | ignored `.env`                    | ignored `.dev.vars` when the Worker exists                                |
| CI                | non-sensitive workflow `env`      | GitHub secrets only if a test explicitly requires them                    |
| GitHub Pages      | build-time public `VITE_*` values | none; a static site cannot hold secrets                                   |
| Cloudflare Worker | public bindings where appropriate | Cloudflare secrets, optionally provisioned by a GitHub environment secret |

WordSoHard is keyless as verified on 2026-10-25. The future adapter must not invent or require an API key unless the provider contract changes.
