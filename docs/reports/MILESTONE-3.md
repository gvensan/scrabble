# Milestone 3 review report

Date: 2026-10-25

WordSoHard OpenAPI 1.1.0 and live endpoints were reverified. The Worker adapter validates 1–20 unique A–Z words, accepts only explicit `valid: true`, validates the entire response at runtime, retries one transient failure, times out, retains attribution, and fails closed on every malformed/network/error path.

Successful lookups use a bounded 512-word, one-hour in-isolate cache, and a conservative per-isolate request budget complements creator/admission throttles. Cached data contains only word validity and expires automatically; it is never stored as game history.

Before awaiting the provider, the room persists an action reservation. On return it reloads and checks the reservation and revision, so an alarm or competing action deterministically wins and late results cannot commit. A live two-browser game formed `OO`; WordSoHard accepted it, the Worker committed it, both clients synchronized two board tiles, and the host subsequently refreshed and recovered its private rack.

Provider constraint: both documented endpoints accept words of 2–30 letters. A syntactically possible 31–40-letter board word is rejected with a neutral verification error rather than accepted unchecked.
