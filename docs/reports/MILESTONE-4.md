# Milestone 4 review report

Date: 2026-10-25

## Completed

- GitHub Pages and Cloudflare Worker deployment workflows use Node 22, the full quality gate, least-privilege GitHub permissions, environment variables for public endpoints, and GitHub/Cloudflare secret stores for credentials and the rate-limit salt.
- Static assets use relative URLs and work under a GitHub Pages project subpath.
- Production origin allowlisting, WebSocket origin checks, hashed admission keys, bounded messages, creator/join throttles, room-code tombstones, and transient dictionary caching are configured.
- A real local Worker smoke test created two browser contexts on a 21×21 timed board, joined and started the room, delivered distinct seven-tile private racks, created a drag/drop draft, rendered the Candy theme, transferred an explicit lobby leave immediately, and closed a lobby at the host's request.
- Axe found zero violations in the host and 375×812 guest game views; the phone document had no horizontal page overflow. Screenshots `13-online-21-candy-desktop.png` and `14-online-21-candy-phone.png` record this run.
- Rejected drafts are highlighted directly on the board with accessible error text, LIFO undo and full-reset recovery. A prominent sidebar countdown and optional synthesized cues announce turns, warnings, errors and time expiry without downloading media or bypassing browser autoplay controls. Screenshots `15-invalid-move-rollback-desktop.png` and `16-invalid-move-rollback-phone.png` cover the recovery state.
- `npm run check`, Wrangler dry-run packaging, and `npm audit --audit-level=high` pass; 38 automated tests pass and the web bundle is about 259 kB (80 kB gzip).

## Deployment status

The repository is deployment-ready. GitHub publication is performed from this checkout. Live Worker and Pages activation remain intentionally gated until Cloudflare credentials and public Worker URLs exist; the workflows skip automatic deployment until their documented `*_DEPLOY_ENABLED` variables are set. No secret is committed.

## Known limits

- A cross-network production smoke test cannot be run before Cloudflare authentication and deployment.
- WordSoHard supports words of 2–30 letters; longer words possible on a 31–40 board fail closed.
- Dictionary caching and request budgeting are per Worker isolate, while room creation/admission throttles are durable and privacy-aware.
- Local games check words from the browser, so they share WordSoHard's per-IP fair-use limit with any other use from that network.

## Post-milestone hardening

- Snapshots carry the latest move (words, score, kind), so both modes show what was just played with WordSoHard definitions on demand, and an estimated score is shown while tiles are placed.
- Rematch rooms are shared: the room records the new code and everyone on the results screen can join it.
- Seat tokens travel in the WebSocket subprotocol header instead of the URL. Refused connections close with 4004/4401 and the client stops retrying; other drops back off exponentially up to 30 seconds.
- Explicit leaves are tracked per seat. A game with fewer than two remaining players ends as `players-left`, and an active room whose last connected player leaves is suspended like a disconnected one.
- A validation reservation older than 30 seconds is treated as stale, so a lost dictionary check cannot lock a room.
- Fixed: a later play touching the board edge was treated as connected; committed board tiles rendered at 42% opacity.
- Arrow-key board navigation with a single tab stop, two-finger pinch zoom, reduced-motion support, tap-to-remove individual provisional tiles, a rules panel, and a device share sheet in the lobby.
