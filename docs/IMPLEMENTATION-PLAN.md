# Delivery plan and quality gates

## Milestone 0: verify assumptions, scaffold
- Validate Cloudflare Free SQLite DO, WebSocket hibernation, Pages workflow with official docs.
- Test WordSoHard OpenAPI and a sample set of actual calls (`qi`, `quiz`, nonsense, plural, 2-letter and crossover case). Record contract, licensing and fair-use requirements. If HTTP probing impossible in Codex environment, mark BLOCKED and use a mock contract until verified; do not claim integration finished.
- Choose original project name, no Scrabble logos. Scaffold npm/pnpm workspace, strict TS, lint/tests/build/CI. Write ADRs for layout/scaled bags and API adapter.
- Gate: clean `install`, typecheck, lint, unit-test harness, build; no paid services.

## Milestone 1: local game engine + visual UX
- Implement deterministic board generator and versioned bonus layout; tile distribution for four presets and custom; server-equivalent rules engine as pure module.
- Welcome/lobby/game/results as state-driven UI, local demo mode with 2-4 simulated seats (no AI), tile placement, score preview, all actions.
- Unit tests for move geometry, crossings, blanks, premiums, ending, huge/small boards, bag proportions.
- Gate: playable pass-and-play simulation, responsive screenshots, accessibility audit and tests. Stop for review.

## Milestone 2: online rooms / backend
- Worker, room directory DO, room DO, SQLite persistence, guest tokens, lobby, WebSocket Hibernation API, routing, snapshots/private racks, revisions and idempotent action IDs.
- Strict state authority, disconnection and alarms, expiry, all-disconnected suspension.
- Gate: real 2-4 browser local integration; race conditions, refresh/rejoin, idle wake, replay attempts, private rack leakage tests; stop for review.

## Milestone 3: dictionary integration
- WordSoHard adapter behind contract, runtime tests with real API where permitted; cache, timeout, error mode, optional attributed definition UI.
- Check all crosswords, never commit on network failure. Ensure timer versus pending dictionary decision is deterministic.
- Gate: fake-server and live provider evidence, mock outage tests, malformed response tests; stop for review.

## Milestone 4: deploy / harden
- GitHub Pages project-base config and Actions workflow; Cloudflare Wrangler config/migrations, CORS and allowed origins, environment setup guide.
- Run end-to-end two devices on distinct networks if available. Monitor Worker/DO free usage, throttle and quotas.
- Gate: published client + worker, smoke test, desktop/mobile screenshots, explicit known issues and cost caveats.

## Deliverable format at each gate
Completed work; changed files; commands run and results; screenshots/URLs where permitted; unresolved risks; how to reproduce; explicit REQUEST FOR REVIEW. Never auto-advance to next milestone.
