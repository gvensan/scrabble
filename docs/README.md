# WordRoom: Codex handoff

A live-only, room-based, English word-board game for 2-4 guest players. Name is provisional; use original branding and graphics, not Scrabble-branded assets.

## Locked product decisions
- GitHub Pages static frontend; React + TypeScript + Vite + Tailwind.
- Cloudflare Worker + SQLite-backed Durable Object per room, WebSocket Hibernation API.
- Private temporary rooms; nickname only, unguessable session tokens, no accounts or retained user history.
- Board sizes 15, 21, 32, custom integer N in [7,40], square N x N.
- Optional per-turn timer: off, 2 minutes, 5 minutes (host decides in lobby).
- Disconnect: 3-minute grace or timer expiry, whichever comes first, then auto-pass. All absent: suspend and expire in 15 minutes.
- English only; WordSoHard is candidate primary provider; never accept words without a positive authoritative response.
- Warm, accessible, polished UI; responsive mobile-first design.
- Free-tier-first architecture. Do not silently add billable dependencies.

## Start here
1. Read `AGENTS.md`, then all documents in this package.
2. Open `CODEX-START.md` and use it as Codex's initial prompt.
3. Complete only milestone 0 and milestone 1 first. Do not deploy or add multiplayer yet.
4. At each gate run tests and deliver a short evidence-based report, including screenshots when applicable.

## Files
- `REQUIREMENTS.md`: product stories, room lifecycle, acceptance criteria.
- `GAME-RULES.md`: deterministic configurable rules and unresolved rule decisions.
- `ARCHITECTURE.md`: trust boundaries, backend, events, state, storage, dictionary adapter.
- `UI-UX.md`: design system, interaction, accessibility, responsive requirements.
- `IMPLEMENTATION-PLAN.md`: milestones and quality gates.
- `TEST-PLAN.md`: unit, integration, multiplayer, resilience and visual checks.
- `AGENTS.md`: binding engineering guidance for coding agent.
- `CODEX-START.md`: initial instruction to paste into Codex.
- `REFERENCES.md`: official/primary documentation and verification checklist.

## Important limits on certainty
WordSoHard is a third-party API and is not an official tournament Scrabble lexicon. Before implementation, verify endpoint, schema, licensing, availability and fair-use restrictions. If verification fails, STOP that integration and report alternatives; do not invent an API response or use an unrelated provider silently.

Infrastructure quotas change. Validate Cloudflare and GitHub platform capabilities at deployment time. Target zero cost, not a guarantee of unlimited free service.
