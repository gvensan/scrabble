# ADR 0001: Original, versioned premium-square layouts

- Status: accepted for Milestone 1 implementation
- Date: 2026-10-25

## Context

The product needs deterministic, balanced premium squares on boards from 7×7 to 40×40 while avoiding copied game branding or a visually identical third-party board. The handoff's “canonical” 15×15 suggestion conflicts with the stronger original-branding guardrail.

## Decision

Use a Scrabble-owned `premium-layout-v1` configuration. The 15×15 board will be a checked-in, explicitly reviewed grid produced for this project, not a copied commercial board. Other sizes use a deterministic generator whose output is materialized in tests and may later be promoted to curated preset data.

The generator will:

1. reserve the opening cell on odd boards and central 2×2 on even boards as neutral start cells;
2. operate on complete rotational/reflection orbits so every output has horizontal, vertical, and 180-degree symmetry;
3. target at most 15% premium cells, reducing the target when orbit sizes prevent an exact count;
4. rank normalized edge/diagonal/center-band candidates using versioned integer rules—never randomness or floating-point hash ordering;
5. allocate TW, DW, TL, and DL in that precedence order, with at least one complete orbit of each type when the board can fit it; and
6. keep all coordinates and the algorithm version in the game configuration so persisted games can be replayed after later layout changes.

Exact candidate bands, counts, and tie-break tuples will be exported constants in the game engine and locked with snapshot, symmetry, density, center, and bounds tests before Milestone 1 is accepted.

## Consequences

This deliberately does not claim standard or official board equivalence. Balance is a product variant and must be evaluated through simulation before publication. Changing the algorithm requires a new version rather than mutating `v1`.
