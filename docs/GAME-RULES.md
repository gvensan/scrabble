# Game rules and board variants

## Baseline
Original Scrabble-inspired gameplay, not represented as official Scrabble. Conventional English tile values/distribution are a *candidate* reference; independently verify reuse rights and rules before claiming standard compliance.
- 15x15 default. Rack 7 tiles, 2-4 players, or online up to 8 ("4+"): a board takes as many players as its bag holds 14 tiles each for (7 on 15x15, 8 on 21x21 and larger, never fewer than 4).
- Random tile bag drawn server-side, initial rack 7, refill after accepted move/exchange.
- First move must intersect center cell on odd board; on even board one of four center cells. All tiles in one row or column, no gaps unless existing letters bridge them.
- Later moves connect to existing board words; all new words created must validate.
- Score is sum across all newly formed words with letter multipliers applying only to newly placed tiles; word multipliers likewise only on newly placed tiles and multiplicatively stack. Bonuses are consumed when covered.
- Blank tile substitutes any A-Z letter (chosen before submit), always 0 base points, receives word but not letter-value benefits.
- Seven newly placed tiles in one turn award +50 bonus.
- Exchange allowed only if >=7 tiles remain in the bag before exchange; player selects 1..rack length, tiles returned and bag reshuffled, replacement drawn; exchange is a scoreless turn.
- Pass is a scoreless turn. Six consecutive scoreless turns (across all players) end the game. A scoring move resets the count.
- If a player's rack empties with empty bag, finish: subtract each player's remaining rack value and award that sum to player who went out. If six scoreless turns end the game, subtract each player's own remaining tile value, no going-out bonus. Ending early by agreement scores the same way. A deduction never takes a score below zero: a player loses at most the points they have. A rejected word scores 0 and costs the turn.
- Room hard expiry: show leaderboard with **provisional / timed-out result** based on current committed scores, not a normal completed game. Avoid inventing standard endgame adjustments.

## Configurable boards
| Size | Cells | Opening target | Bonus layout | Tile bag |
| --- | ---: | --- | --- | --- |
| 15x15 | 225 | center | fixed canonical design | baseline bag |
| 21x21 | 441 | center | symmetric generated layout | scaled distribution |
| 32x32 | 1024 | central 2x2 | symmetric generated layout | scaled distribution |
| custom 7..40 | N² | one center or central 2x2 | symmetric generated layout | defined size-aware distribution |

### Deterministic layout algorithm (proposed v1)
- 15 board: explicitly store known 15x15 bonus-square grid in versioned data file; validate symmetry and count with unit tests.
- Other boards: generate a fourfold-symmetric bonus grid from normalized coordinates relative to edges/center; use no randomness. Resolve collisions with a fixed precedence TW > DW > TL > DL, reserve opening cells as neutral or starting marker; no more than ~15% of cells are multipliers, enforce a minimum of each type where feasible. Store schema/algorithm version alongside game.
- Render labels TW/DW/TL/DL and color; color alone cannot convey meaning.
- Default bag scaling **must be deliberate**: `targetCount = round(100 * (N*N/225) ** 0.5)`, clamped to 60..240; allocate per letter by largest-remainder apportionment to original 100-tile weights; ensure 2 blank tiles for baseline, scale blanks proportionally for larger boards with min 2; adjust allocation to exact total. This is a product-defined variant, not official Scrabble rules. For N=15 use the baseline bag unchanged. Document precise rounding, tie-breaks and tests.
- 7..40 cells is allowed even where rack and bag lead to short or unusual games; show a gentle notice in room settings for N<11 or N>21.
- The UI must support large boards with pan/zoom, snap-to-cell, minimap optional; do not reduce interactive cells to illegible 8px targets on phones.

## Dictionary
- Primary candidate WordSoHard; not official NWL/CSW. Accepted words are exactly those recognized by provider's selected lexicon. Version/identity and provider are displayed in Rules/About.
- Server checks word normalization and exact result membership. Validity is the provider's explicit `scrabble.valid` or documented equivalent, NOT merely `found` or existence of a definition.
- An API may return validity for strings which are inappropriate for this game's A-Z only rules; reject any input outside `^[A-Z]+$` after normalization.
- Limit max word length to board size. No punctuation, spaces, hyphens, proper names by bespoke inference, or manual overrides in v1; provider controls lexicon membership.
- Validate all cross words, deduplicate within submitted move. For a one-tile first move, require a legal connected word of at least 2 letters; no one-letter plays.
- Dictionary check outage/timeout: retain turn, allow retry until server deadline; do not accept unchecked words or modify rack/bag/board.

## Open-but-bounded implementation decisions
The tile distribution and generated premium-square algorithm above are v1 proposals, not canonical rules. Implement them with tested, versioned configuration, document the resulting boards and verify game balance through simulation before publishing as 'final'. The specific language word-list is provider-defined; do not claim tournament compliance.
