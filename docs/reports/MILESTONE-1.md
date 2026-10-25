# Milestone 1 review report

Date: 2026-10-25

## Completed

- Pure strict-TypeScript game engine shared by the UI, with no browser or Cloudflare imports.
- Deterministic 7–40 board construction, neutral opening cells, symmetric original premium layouts, and a 15% premium-cell ceiling.
- Exact size-aware tile-bag totals and largest-remainder allocation.
- Legal opening, row/column geometry, gap and connection checks; cross-word extraction; blank assignment; new-tile-only premiums; stacked word scoring; seven-tile bonus; rack refill.
- Pass, exchange, six-scoreless-turn ending, empty-bag/rack ending, and final rack deductions.
- Responsive Welcome, Settings, Lobby, Active Game, privacy handoff, blank chooser, confirmation, invalid-move, and Results states.
- Tap/select placement, keyboard-operable native controls, independent board panning, zoom controls, rack recall/shuffle/exchange/pass, optional 2/5-minute local turn timer, and readable premium labels.
- Explicitly labeled deterministic demo validator. It accepts syntactically valid A–Z words only and never claims provider verification.

## Evidence

- `npm run check`: formatting, strict ESLint, all workspace typechecks, 19 tests, and all production builds pass.
- `npm audit --audit-level=high`: zero vulnerabilities.
- Automated Axe scans of Welcome, privacy handoff, and active game at 375×812: zero detected violations after fixes.
- Automated browser flow created a game, made a valid move, retained an invalid draft, passed six turns, and reached Results.
- Screenshots are in `artifacts/screenshots/` for phone Welcome, Settings, Lobby, Waiting, Active, Invalid, and Results plus tablet and desktop Active states.

## Run locally

```sh
cp .env.example .env
npm install
npm run dev
```

For the full gate:

```sh
npm run check
```

## Known limitations

- Local pass-and-play only; reload does not persist a game.
- The demo validator is deliberately permissive and has no definitions. WordSoHard integration remains Milestone 3.
- Board zoom uses buttons; touch panning works through native overflow, but pinch-zoom and arrow-key grid navigation are not yet specialized.
- No Worker, rooms, sockets, tokens, reconnect behavior, or deployment exists yet.
- Layout and distribution are product variants and still require balance simulation and final branding/rights review.

## Review gate

Milestone 1 is ready for hands-on local review. Do not infer that multiplayer or authoritative dictionary validation is complete.
