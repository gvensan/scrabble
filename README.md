# Scrabble

Scrabble is a live, room-based word-board game for 2–4 friends. It supports local pass-and-play and authoritative online multiplayer with private racks, reconnectable guest seats, server-validated words, prominent optional turn clocks, accessible tap or drag placement, board zoom, rollback controls, optional sound cues, and Garden, Candy, and Midnight themes.

Play it at https://gvensan.github.io/scrabble/ (source: https://github.com/gvensan/scrabble).

The static React client is designed for GitHub Pages. A Cloudflare Worker coordinates rooms through SQLite-backed Durable Objects and hibernating WebSockets; WordSoHard validates every word formed by an online move.

## Local setup

Requirements: Node.js 20.19 or newer and npm 10 or newer.

```sh
npm ci
npm start          # local Worker on :8787 and web app on :5174, in the background
npm run status     # show what is running
npm run restart    # stop, then start again
npm stop           # stop both
```

`npm start` creates `.env` and `apps/worker/.dev.vars` from their examples if they are missing, waits until both servers respond, and writes logs to `.dev/worker.log` and `.dev/web.log`. Add `--reset` to a restart (`npm run restart -- --reset`) to clear local rooms and rate limits. The scripts use `lsof` and process groups, so they target macOS and Linux.

Open `http://127.0.0.1:5174`. Use **Play online with friends** for a two-browser room or create a local pass-and-play game. Both modes check every word with WordSoHard: local games call it from the browser, online games through the authoritative Worker. Playing needs an internet connection.

## Admin dashboard

Open `#/adminit` (for example http://127.0.0.1:5174/#/adminit). Access is controlled by the Worker's `ADMIN_TOKEN` environment variable and is off when it is unset. Locally it lives in `apps/worker/.dev.vars`, and the dev server reads it from there (or from `ADMIN_TOKEN` in the shell), so the dashboard opens without a sign-in. Production builds never embed the token, since the web bundle is public; the deployed dashboard asks for it once per tab. Set it in production with `wrangler secret put ADMIN_TOKEN`. The dashboard shows open rooms and their players, a table of finished online games (date and time, participants, scores, winner, margin, length, best play, ending) with filtering and CSV export, daily activity counters, a nickname leaderboard, and current rate limits with a button to clear them. Selecting a room opens its page: settings, timing, whose turn it is, each participant's score, words, tiles placed, best play, passes, exchanges and end-of-game adjustment, the full move list and the board. From there an admin can delete the room after a confirmation; everyone in it is disconnected with the room-gone close code, its storage and alarm are cleared, and it disappears from the dashboard. Its code stays reserved so it cannot point at a new game, and a game that had already finished stays in the past games table. Same-device games never reach the server and are not recorded. Closed rooms are kept for 7 days and finished games for 180 days. No tokens, racks or IP addresses are stored.

`ROOM_CREATE_LIMIT` sets how many rooms one network may create per hour (default 10). Local development shares one address for every tab, so `.dev.vars.example` raises it to 200.

## Quality and deployment

```sh
npm install
npm run check
npm audit --audit-level=high
```

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for GitHub Pages and Cloudflare setup, [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) for the secrets policy, and [`docs/`](docs/README.md) for the product and engineering specifications.
