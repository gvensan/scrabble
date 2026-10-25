# Architecture and wire contracts

## Topology
`React Vite SPA (GitHub Pages)` -> `HTTPS API & WebSocket upgrade (Cloudflare Worker)` -> `Room Directory DO (allocation)` and `Room DO (one per room, SQLite)` -> `WordSoHard HTTP API`.

Worker hosts `/api/rooms` create, `/api/rooms/{code}` lookup/join, `/health`, and `/ws?room=...`; exact routes may vary, but publish OpenAPI-ish request/response types and validation. Browser uses no API secrets.

## Core types (illustrative, define precise Zod schemas)
```ts
type RoomPhase = 'lobby' | 'active' | 'suspended' | 'results' | 'expired';
type TimerMode = 0 | 120 | 300;
type Player = { id:string; nickname:string; score:number; connected:boolean; ready:boolean; rackCount:number };
type PublicRoom = { roomCode:string; phase:RoomPhase; settings:{ size:number; capacity:2|3|4; timerSeconds:TimerMode }; players:Player[]; board:Cell[]; bagRemaining:number; currentPlayerId:string|null; turnDeadline:number|null; revision:number; expiresAt:number };
type PrivateSeat = { playerId:string; rack:Tile[]; reconnectToken:string }; // NEVER broadcast
```
Tile IDs server-generated, not guessable by clients. Avoid sending room session token in generic JSON logs. Explicitly differentiate public vs private serialization.

## Messages
Client -> server:
- `room.ready`, `room.start`, `game.play` `{actionId,revision, placements:[{tileId,row,col,blankAs?}]}`,
- `game.pass` `{actionId,revision}`, `game.exchange` `{actionId,revision,tileIds}`, `room.leave`, `sync.request`.
Server -> client:
- `room.snapshot` (sanitized), `seat.private` (only authenticated seat), `room.roster`, `game.pending`, `game.move.accepted`, `game.move.rejected` (requester only), `game.turn`, `game.finished`, `room.expired`, `error`.
Include protocolVersion, server timestamp, revision and event/action id. Each message has runtime validation and bounded payload lengths. Acknowledged action IDs never execute twice; changed state and move event are transactionally consistent.

## Concurrency and external dictionary wait
Durable Objects serialize synchronous events, but network awaits may interleave. Never assume an awaited fetch locks the room. On move start: atomically reserve a pending action against revision+turn; validate local rules; call provider with bounded timeout; on response recheck pending action, deadline and revision; commit in storage atomically or reject. Other actions cannot advance the same turn while pending except an explicitly defined deadline resolution that must deterministically win. Add tests for fetch response after timer expiry, duplicate request, disconnected actor, and simultaneous player attempts.

## Room code allocation
Use directory DO to claim collision-resistant random room codes; persist code -> unique room identifier and expiry/tombstone. Expired room IDs never become valid accidentally. Set expiry cleanup with alarms in both directory and room. Do not place player tokens in URL; invite contains only room code. Rate-limit allocations and joins. Stable object identifier assigned from server-generated random ID.

## Persistence / alarms
SQLite room snapshot + action-id record + room expiry metadata. Persist after each accepted transaction, use alarms for turn and expiry. Reconstruct timer and socket attachments after hibernation. On expiry delete data and mark terminal; directory removes mapping after safe tombstone interval. Version schema and migrations. Avoid retaining definition API response beyond bounded necessary cache; no permanent history.

## WordSoHard adapter
Official provider reference: https://wordsohard.com/api and https://github.com/Kumar-Media-LLC/wordsohard-api-examples . Documented example `GET https://wordsohard.com/api/v1/define/quixotic` returns `scrabble.valid` and `scrabble.score`, with `found` separate; verify current OpenAPI schema and live responses before using. Earlier conversation mentioned a `check` batch endpoint, but DO NOT ASSUME ITS AVAILABILITY until verified; a single-word define lookup per unique cross-word may be the dependable route. Add adapter interface `validateWords(words: string[]): Promise<Map<string,ValidationResult>>`, concurrency cap, request timeout and retry once on transient failure; dedupe and bound cache. Provider explicitly requests attribution wherever definitions appear and approximately <=60 requests/min/IP; distributed Cloudflare egress identity complicates per-IP assumptions, so design a modest global rate budget / backoff. Do not fall back to general dictionary valid=true on API failure. Record an engineering decision if provider's API fails verification.

## Security
Server-issued, cryptographically strong session tokens; store hash if practical, bind seat, expire with room; WebSocket authenticate at handshake, check Origin allowlist and room permission; HTTPS/WSS only. Zod-like schemas for all messages; normalized nicknames, escaped rendering, max payload size, per-session rate control, CSRF/CORS constraints for HTTP endpoints, no PII logging, no browser-visible credentials.

## Free-tier operations
Use Hibernation WebSocket API, no busy loops; minimize stored rows and broadcast payloads; instrument requests, duration, storage, provider errors. Cloudflare Free limits apply; on quota exhaustion show graceful errors and reject new room creations. Never claim $0 at arbitrary scale.
