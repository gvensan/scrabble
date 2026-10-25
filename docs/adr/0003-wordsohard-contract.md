# ADR 0003: WordSoHard behind a verified adapter

- Status: accepted for architecture; integration deferred to Milestone 3
- Date: 2026-10-25

## Context

Dictionary acceptance is authoritative and cannot depend on definitions or an undocumented endpoint.

## Decision

Retain the provider-neutral `validateWords(words)` boundary. The planned WordSoHard implementation will use the currently documented batch endpoint `GET /api/v1/check/{words}` for 1–20 unique, normalized words of 2–30 A–Z characters. It will accept a word only when its matching result has `valid: true`.

The adapter will validate the complete response at runtime, preserve input/result correspondence, apply a bounded timeout and rate budget, and fail closed on HTTP, timeout, malformed, missing, or ambiguous results. Definitions are optional presentation data and their `found` field never decides legality.

The UI must display the provider's returned attribution wherever its data appears and identify the lexicon as the WordSoHard Word List, not an official tournament lexicon. Before Milestone 3 ships, rerun the live contract probes and review the then-current API terms.

No browser request will carry a credential. If the provider later requires a key, it must be a Worker-only Cloudflare secret locally represented in ignored `.dev.vars` and supplied to deployment through secrets—not a `VITE_*` variable.

## Evidence

On 2026-10-25, OpenAPI 1.1.0 advertised `/check/{words}`, `/define/{word}`, and `/unscramble/{letters}`. Live probes returned valid results for `qi`, `quiz`, `cats`, and `at`, and invalid for `zzqzx`; the five-word batch returned the same decisions. The published contract says free personal/commercial use with attribution and roughly 60 requests/minute/IP. These facts are time-sensitive and are not a completed integration.
