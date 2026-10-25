# Agent instructions for WordRoom

## Scope
Read and follow the Markdown specifications. Implement incrementally in the approved milestone order. Never treat an illustrated UI mockup or a pseudo-flow as executable logic.

## Musts
1. Use TypeScript strict mode across `apps/web`, `apps/worker`, and `packages/game-engine`.
2. Keep all gameplay rules in a pure deterministic, thoroughly tested shared package. Do not duplicate scoring in UI and Worker.
3. The server is authoritative for rack contents, tile bag, turn, score, accepted moves, and dictionary outcomes.
4. Do not send hidden tile bag, other players' racks, room tokens, or server secrets in public state broadcasts.
5. Sanitize strings and validate all HTTP and WebSocket inputs at runtime. Never trust client-calculated scores or coordinates.
6. Use durable room state, atomic transitions, server-issued deadlines and idempotent action IDs.
7. Design every timer to work after Durable Object hibernation/restart. Use durable alarms, not a continuously-running `setInterval` for game progression.
8. Default to minimal, accessible, touch-friendly, mobile-first UX. Verify keyboard actions and 320px viewport.
9. Don't add auth services, external databases, paid tools, telemetry trackers, or an AI dependency.
10. Do not add actual trademarked Scrabble branding or copyrighted word lists without verified rights.
11. For any uncertainty about the WordSoHard contract, make a live probe and inspect primary documentation. Do not guess.
12. Avoid introducing production deployment credentials into the repo. Provide setup instructions; use GitHub Secrets/Cloudflare environment config.
13. Each milestone must include tests, lint, typecheck, build, screenshots, known limitations and a concise review report.
14. Work on one milestone per request; do not silently continue to the next phase.

## Architecture guardrails
- `apps/web`: React + Vite. Static output for GitHub Pages subpath; hash routes or correct base-path handling.
- `apps/worker`: Cloudflare Worker + SQLite-backed Durable Object; WebSocket Hibernation API.
- `packages/game-engine`: rules/configuration/protocol types, no browser or Cloudflare imports.
- `packages/ui` optional only if useful; avoid unnecessary complexity.
- Use `crypto` quality room/session tokens, avoid predictable numeric identifiers.
- Room-code allocation must enforce uniqueness among live rooms, with expiry/tombstone protection; do not assume hash collisions impossible.
- Use a room-directory DO or other explicit design, explain operations and cleanup.
- Cap max rooms per creator/IP and admission attempts with privacy-aware controls.

## Work method
At the start of each milestone: list interpretation and gaps. If a gap has a safe default covered in docs, choose it and record an Architecture Decision Record. Otherwise stop only when the gap blocks correct behavior. Implement, test, review visuals, report. No simulated successful tests.
