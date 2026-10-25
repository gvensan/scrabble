# Milestone 4 review report

Date: 2026-10-25

## Completed

- GitHub Pages and Cloudflare Worker deployment workflows use Node 22, the full quality gate, least-privilege GitHub permissions, environment variables for public endpoints, and GitHub/Cloudflare secret stores for credentials and the rate-limit salt.
- Static assets use relative URLs and work under a GitHub Pages project subpath.
- Production origin allowlisting, WebSocket origin checks, hashed admission keys, bounded messages, creator/join throttles, room-code tombstones, and transient dictionary caching are configured.
- A real local Worker smoke test created two browser contexts on a 21×21 timed board, joined and started the room, delivered distinct seven-tile private racks, created a drag/drop draft, rendered the Candy theme, transferred an explicit lobby leave immediately, and closed a lobby at the host's request.
- Axe found zero violations in the host and 375×812 guest game views; the phone document had no horizontal page overflow. Screenshots `13-online-21-candy-desktop.png` and `14-online-21-candy-phone.png` record this run.
- `npm run check`, Wrangler dry-run packaging, and `npm audit --audit-level=high` pass; 38 automated tests pass and the web bundle is about 259 kB (80 kB gzip).

## Deployment status

The repository is deployment-ready. GitHub publication is performed from this checkout. Live Worker and Pages activation remain intentionally gated until Cloudflare credentials and public Worker URLs exist; the workflows skip automatic deployment until their documented `*_DEPLOY_ENABLED` variables are set. No secret is committed.

## Known limits

- A cross-network production smoke test cannot be run before Cloudflare authentication and deployment.
- WordSoHard supports words of 2–30 letters; longer words possible on a 31–40 board fail closed.
- Dictionary caching and request budgeting are per Worker isolate, while room creation/admission throttles are durable and privacy-aware.
- Native overflow provides touch panning and explicit zoom buttons; specialized pinch zoom and arrow-key grid navigation are future enhancements.
