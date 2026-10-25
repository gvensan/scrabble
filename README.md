# Squabble

Squabble is a live, room-based word-board game for 2–4 friends. It supports local pass-and-play and authoritative online multiplayer with private racks, reconnectable guest seats, server-validated words, optional turn clocks, accessible tap or drag placement, board zoom, and Garden, Candy, and Midnight themes.

The static React client is designed for GitHub Pages. A Cloudflare Worker coordinates rooms through SQLite-backed Durable Objects and hibernating WebSockets; WordSoHard validates every word formed by an online move.

## Local setup

Requirements: Node.js 20.19 or newer and npm 10 or newer. In separate terminals:

```sh
cp .env.example .env
cp .dev.vars.example apps/worker/.dev.vars
npm ci
npx --yes wrangler@4.61.1 dev --local --config apps/worker/wrangler.jsonc
```

```sh
npm run dev
```

Open `http://localhost:5173`. Use **Play online with friends** for a two-browser room or create a local pass-and-play game. Local mode intentionally uses a permissive demo validator; online mode uses the authoritative Worker and WordSoHard.

## Quality and deployment

```sh
npm install
npm run check
npm audit --audit-level=high
```

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for GitHub Pages and Cloudflare setup, [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) for the secrets policy, and [`docs/`](docs/README.md) for the product and engineering specifications.
