# ADR 0002: Deterministic size-aware tile bags

- Status: accepted for Milestone 1 implementation
- Date: 2026-10-25

## Context

The handoff specifies a target bag size but leaves blank handling and largest-remainder ties ambiguous.

## Decision

`tile-bag-v1` will use the documented baseline 100-tile weights as project configuration, subject to the repository's rights review and without claiming official compatibility.

For board size `N`:

1. `target = clamp(roundHalfUp(100 × N / 15), 60, 240)`; the algebraically equivalent square-root form is not used in code, avoiding floating-point square-root drift.
2. For `N = 15`, return the unchanged, explicitly versioned baseline distribution.
3. Otherwise, `blanks = max(2, roundHalfUp(2 × target / 100))`.
4. Allocate the remaining `target - blanks` tiles among A–Z in proportion to their non-blank baseline counts (denominator 98).
5. Take every floor allocation, then award remaining tiles by descending fractional remainder. Break equal remainders by ascending letter A–Z.
6. Assert that every count is a non-negative integer and the exact total equals `target`.

Injected deterministic pseudo-random sources are permitted only in tests and local demonstrations. Production bag shuffling must use cryptographically secure server-side randomness.

## Consequences

Expected totals are 60, 100, 140, 213, and 240 for board sizes 7, 15, 21, 32, and 40. The variant is reproducible but not represented as an official distribution.
