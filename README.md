# Scrabble

Scrabble is a live, room-based word-board game for 2 to 8 friends (online rooms take more than four when the host picks "4+", as many as the board's tile bag allows: 7 on 15×15, 8 on 21×21 and larger; same-device games take 2 to 4). It supports local pass-and-play and authoritative online multiplayer with private racks, reconnectable guest seats, server-validated words, prominent optional turn clocks, accessible tap or drag placement, board zoom, rollback controls, optional sound cues, and Garden, Candy, and Midnight themes.

Play it at https://scrabble.vainko.in/ (source: https://github.com/gvensan/scrabble).

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

## Voice chat

The host can turn on voice chat when creating an online room. Each player taps the mic to join (the browser asks for microphone access), can mute themselves from the turn card, and can switch other players' voices or the game sounds off from the speaker menu. The header and scoreboard light up whoever is talking. Audio goes directly between browsers over WebRTC and is never recorded; the room's WebSocket only relays the connection messages, and nothing about voice is stored. Free public STUN servers are enough for most networks. Players behind strict office, hotel or mobile networks also need a TURN relay: create a Cloudflare TURN key and set `TURN_KEY_ID` and `TURN_KEY_API_TOKEN` with `wrangler secret put`. The first 1,000 GB a month are free, and voice uses about 90 MB per relayed player per hour. Without these, voice falls back to STUN only.

## Game summary

When a game ends, every player lands on the results page: who won and why, a **Leaderboard** tab (rank, score, plays, best word, bingos, average time per turn and the end-of-game tile adjustment) and a **Moments** tab (the best plays with each word's meaning, the quickest plays, the longest word and any bingos), followed by the final board. Online games keep this summary on the Worker for 180 days, so it can be opened again at `?game=CODE`; **Copy link to this summary** on the results page shares it, and anyone with the link can view it. The meanings of the highlighted words are looked up once, when the game ends, and stored with it. Each browser also lists the games it finished under **Past games** on the start screen. Same-device games have no server copy: their summary lives only in that browser's list (the latest 20 games). A summary holds nicknames, scores, words, turn times and the final board; no tokens, racks or IP addresses.

## Admin dashboard

Open `#/adminit` (for example http://127.0.0.1:5174/#/adminit). Access is controlled by the Worker's `ADMIN_TOKEN` environment variable and is off when it is unset. Locally it lives in `apps/worker/.dev.vars`, and the dev server reads it from there (or from `ADMIN_TOKEN` in the shell), so the dashboard opens without a sign-in. Production builds never embed the token, since the web bundle is public; the deployed dashboard asks for it once per tab. Set it in production with `wrangler secret put ADMIN_TOKEN`. The dashboard has three tabs: **Rooms** lists the rooms open right now (lobbies and games in play), **Past games** lists finished online games (date and time, number of participants, winner, score, margin, length, board, turns, best play, ending) with filtering and CSV export, and **Players** is a nickname leaderboard. In Past games the room code opens that game's summary page in a new tab; games that were abandoned, or finished before summaries were kept, have no summary and show a plain code. A rate-limit banner with a button to clear the limits appears above the tabs only while a network is blocked. Selecting a room opens its page: settings, timing, whose turn it is, each participant's score, words, tiles placed, best play, passes, exchanges and end-of-game adjustment, the full move list and the board. A finished game's page and its row in the past games table link to the game's public summary, and once the room has closed the room page shows the final board from that summary. From there, or by ticking rooms in Rooms or games in Past games and choosing **Delete**, an admin can delete after one confirmation. Delete wipes the game everywhere: everyone in the room is disconnected with the room-gone close code, the room's storage and alarm are cleared, and its dashboard row, Past games entry, leaderboard and totals contributions, "rooms today" count and public summary page are removed. A player's device drops it from its Past games list the next time the summary is opened. Only the code stays reserved for the room's 28-hour lifetime, so an old invite link cannot reach a different game. In Rooms, **Archive** instead hides the ticked rooms from the list without touching them (live games carry on), and **Unarchive** (with **Show archived** on) brings them back. A **Status** filter narrows the list to lobbies or games in play. Same-device games never reach the server and are not recorded. Closed rooms are kept for 7 days and finished games for 180 days. No tokens, racks or IP addresses are stored.

`ROOM_CREATE_LIMIT` sets how many rooms one network may create per hour (default 10). Local development shares one address for every tab, so `.dev.vars.example` raises it to 200.

## Quality and deployment

```sh
npm install
npm run check
npm audit --audit-level=high
```

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for GitHub Pages and Cloudflare setup, [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) for the secrets policy, and [`docs/`](docs/README.md) for the product and engineering specifications.
