# Test and release plan

## Unit matrix
- Board size N=7,15,21,32,40; bonus symmetry and center, deterministic output, no out-of-bound coordinate.
- Tile bag totals exact and known baseline 100; rack max 7; reproducible drawing with injected test PRNG; production uses secure random generator.
- Horizontal/vertical geometry; no diagonal/disconnected tiles; first move center region; bridge gaps only by existing tiles; crosswords; no isolated single-letter words.
- Double/triple letter/word multiplier handling, stack order, old premium squares not re-applied, blank zero, seven-tile bonus and final rack deductions.
- Pass, exchange minimum bag count, six scoreless turns, empty bag going-out, max-lifetime timeout standings.
- Word normalization, duplicate extraction, provider explicit-valid parsing, invalid results, timeout/429/500/malformed results.

## Multiplayer and security
- Create 100+ concurrent test rooms with randomized codes (locally), no collisions in active directory; deliberate collision test.
- A and B submit concurrently; only current player action commits. Duplicate action ID does not draw twice. Stale revision rejected.
- Refresh with correct token receives own rack, not others'; wrong token denied. Duplicate tabs single active writer.
- Wrong-room token, forged tile IDs, forged scores, invalid blank, malformed messages, oversized payload, wrong Origin rejected.
- Host disconnect in lobby and replacement; active room host disconnect does not terminate game.
- Deadline vs pending dictionary result; timeout beats late response per precise policy; no double turn advance.
- All disconnected -> suspend and expire; one reconnect -> resume; no stale alarms after completion.
- Expired game code cannot rejoin or resurrect an old room.

## UX and accessibility
- Screens at 320/375/430/768/1440 widths. No page horizontal scrolling, rack stays usable; huge board pan/zoom plus keyboard route.
- Real tap-to-place and blank assignment; invalid placement retains draft; pass/exchange confirmation; clear timer.
- Screen-reader landmarks and status announcements; contrast, keyboard-only flow, reduced motion.
- Network throttling: dictionary failure, websocket reconnect, Worker quota errors, slow start, room full.

## Performance / cost
- Track message count per move, WS reconnect traffic, DB writes, total room footprint, request/compute consumption. Demonstrate idle socket hibernation using Cloudflare metrics where possible.
- Bound cached word lookups and message size. Avoid frequent sync polling and client-generated timer network ticks.

## Evidence
Tests must actually execute. Report test commands and results plus screenshots. Never mark live provider integration done using only a mocked API.
