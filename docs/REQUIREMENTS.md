# Functional requirements v1

## Core objective
A guest opens a public static site, creates or joins a private temporary room, plays a live English tile-based word game with 2-4 friends, and sees final scores. No registration, historic statistics or matchmaking.

## Pages / states
1. Welcome: nickname, Create Game, Join Game; invite URL prepopulates room.
2. Create settings: board 15/21/32/custom 7..40; player cap 2..4; timer off/2m/5m; concise board-size impact note.
3. Lobby: unique invite link with copy/share, roster with connected indicators, host controls (start, lock/unlock against new joiners), host can start once >=2 players have joined; settings locked once started.
4. Game: zoomable board, scores, current player, private rack, bag count, provisional placement, Play, Recall, Shuffle, Exchange, Pass, rules, connection status, word details.
5. Results: final scores, rankings, reason game ended, optional rematch creates new room, exit; no history after expiry.

## Room behavior
- Only guest nickname and session token. Nickname unique within room, normalized and length-limited.
- Code 6+ characters from unambiguous alphabet; provide copyable URL. Code is convenience, not authentication.
- Player cap locked in lobby. No replacement players after start. Rejoin seat with session token stored in sessionStorage; if token missing cannot claim occupied seat.
- A user opening the game in a new browser/device without token joins as new guest only when the lobby has room.
- Duplicate-tab policy: newest authenticated connection owns action permission, earlier is read-only/closed. Do not broadcast private state to unauthenticated connections.
- Lobby host disconnect: transfer to another connected player after grace or on explicit leave.
- Lobby expires after 30 min from creation unless started; empty active room suspends, expires 15 min after all connections are absent. Hard lifetime 4h. Results persist 10min then delete.
- Single player disconnect: mark offline and start grace 3 min. If timer is on, earlier of turn deadline and grace deadline triggers auto-pass on that player's active turn. If absent during other players' turns, skip absent player's turn when it arrives after grace expires. Do not skip a connected player's turn.
- Auto-pass counts as scoreless turn. If all players absent: suspend clocks and progression; on reconnect restore state/turn according to documented policy and keep total hard expiry unchanged.
- Explicit voluntary exit keeps existing seat absent; not transferable. UI allows leaving.
- Host can lock the lobby to stop new players joining without affecting players already seated; the last player leaving an unstarted lobby deletes it; gameplay can end by configured end rules, fewer than two remaining players, or hard expiry.
- Expired code cannot reopen an old game. Appropriate tombstone/expiry handling.

## Gameplay
- Up to 4 racks private; player cannot submit another player's move.
- Preview placed letters client-side; submit coordinate+tile identifiers, expected state revision and action ID; never submit authoritative computed scores.
- Word validator checks ALL newly formed words (main and perpendicular), including blank substitutions. Reject bad move as a whole; retain same turn if deadline not elapsed.
- Dictionary API outage: do not commit move. Expose retry with timeout and neutral message; correctly reconcile turn deadline during asynchronous check.
- Use an explicit validation-in-progress gate to prevent a second conflicting action. Persist/check action status for idempotency.
- No chat, AI bot, spectator mode, profile, ranking, analytics, or multilingual words in v1.

## Quality / nonfunctional
- No horizontal page scrolling at 320px; board viewport may pan/zoom independently.
- Touch: tap-to-select then tap-to-place; drag optional. Keyboard equivalent, focus indicators, readable bonuses.
- Responsive desktop/tablet/mobile; support reduced motion, screen readers, contrast and turn announcements.
- Fast feedback for local placements. Network failure UI never pretends a move succeeded.
- Static app works at GitHub Pages project subpath; HTTPS to Worker; explicit CORS and WS origin policy.
- All player actions validated on backend; server-generated random tile shuffle with secure randomness.
- Persist only minimum active game details; purge on expiry; no persistent personal analytics.

## Excluded
Tournament dictionary licensing, official Scrabble branding, public matchmaking, rankings, accounts, chat, saved history, spectators, tournament administration, AI opponents.
