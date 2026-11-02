# Fact ledger grammar

`fact-ledger.json` is the single source of numbers and quotes for a research run. This file is
the one definition of what a valid ledger is. `scripts/fact-ledger-schema.mjs` encodes it as
data (`TRANSITIONS`, `transitionError`, `provenanceErrors`), and both the validator
(`validateLedger`) and every writer (`addRow`, `retractRow`, `supersedeRow`, `writeLedger`)
call that same code. A writer can therefore never produce a ledger the validator rejects, and
the validator can never accept a ledger no writer could produce.

## Ledger

```
ledger := { schemaVersion: 1, rows: row[], events: event[] }
```

`rows` is append-only: a row is never deleted or reordered. `events` is append-only and
ordered; an event's position is its time.

## Ids

```
fact_id   := "F" digits      for kind in measured | derived | assumed | converted
           | "Q" digits      for kind = quote
source_id := "S" digits
```

`nextId` returns the prefix plus one more than the largest number already used for that
prefix. `C<n>` is reserved for claim-graph nodes and never appears in the ledger. Fact ids are
unique across all rows.

## Rows

Every row carries every field of `ROW_FIELDS`; unknown fields are rejected.

The per-kind table below is rendered from `KIND_RULES` in `scripts/fact-ledger-kinds.mjs`
(`node scripts/fact-ledger-kinds.mjs --render-grammar`); the validator checks every per-kind
column through that same table, and a test keeps this copy equal to the rendered output.

Always required, never null: `fact_id`, `kind`, `raw` (string), `quote` (string),
`extracted_by` (non-empty), `observed_at` (ISO timestamp), `label` (`[a-z0-9_-]{1,32}`),
`status`.

<!-- kind-rules:begin (rendered from KIND_RULES; do not edit by hand) -->
| field | measured | quote | derived | assumed | converted |
|---|---|---|---|---|---|
| `fact_id` | `F<n>` | `Q<n>` | `F<n>` | `F<n>` | `F<n>` |
| `value` | decimal | null | decimal | decimal | decimal |
| `source_id` | `S<n>` | `S<n>` | `S<n>` or null | `S<n>` or null | `S<n>` or null |
| `locator` | object | object | object or null | object or null | object or null |
| `snapshot_sha256` | sha256 | sha256 | sha256 or null | sha256 or null | sha256 or null |
| `rationale` | string or null | string or null | string or null | non-empty | string or null |
| `exact` | from `value` | null | reduced rational | rational or null | reduced rational |
| `context` | quote context or null (legacy) | quote context or null (legacy) | written by derive (object or null) | null | written by derive (object or null) |
| `operation` | null | null | sum/diff/growth/share/ratio/expr | null | `convert` |
| `precision` | null | null | `{ places, sigfigs }` | null | `{ places, sigfigs }` |
| `compatibility` | null | null | checked or unchecked (expr) | null | checked or unchecked (expr) |
<!-- kind-rules:end -->

- `exact` is `{ num: integer string, den: positive integer string }` or null. A measured row's
  `exact` must equal the reduced rational of its `value` (`exactFromDecimal`); `addRow` fills
  it when the caller leaves it null. Derived and converted rows get it from
  derive (plan todo 9): a converted value's rational comes from the original and the factor,
  not from the rounded `value`, so `addRow` never computes it from `value`.
- `locator` is `{ artifact, char_start <= char_end, unit?, page?, line?, table?, row_label?,
  col_label? }`: `char_start/char_end` are a half-open byte range of `artifact` (raw.bin, or
  text.txt for a declared or converted extraction) in its own encoding; new rows write
  `unit: "bytes"`. No unit marks a legacy text locator.
- Source `snapshot_sha256` binds the pinned body exactly (raw.bin; text.txt for converted-only). Source `context` is `{prefix, suffix}`, each
  at most 32 Unicode characters copied around the value span, or the whole quote for Q rows.
- All other fields are nullable with the types in `fact-ledger-schema.mjs`.

Exact rational integer strings are canonical: no leading zeros, negative zero, negative denominator,
or common factors. Unit aliases normalize at input, with numeric scaling for basis-point factors
in composites. Derived rows store canonical units, compared exactly, including symbols' case; a source
row's registered alias is canonicalized when the ledger is read (`unit-rules.md` dimension 31).

A ledger written before `context`, `precision`, and `compatibility` existed still loads: source rows
read those columns as null, and older derived or converted rows load but are never used as operands.

Derived and converted rows require a matching operation, its closed context, distinct existing operands,
formula, derived_from, precision, and compatibility. Source rows cannot carry derivation fields.
Precision records nonnegative decimal places and positive significant figures, independently of display
text. Recomputation verifies redundant audit fields and recursively verifies each shared dependency once.
New work may consume only active transitive dependencies; historical verification ignores current eligibility.

## Labels

A label is unique across ALL rows, whatever their status. Retracting or superseding a row does
not free its label.

## Provenance

`operands` and `derived_from` are arrays of fact ids. Every id must name an existing row and
must not be the row's own id. Taken together over all rows, these references form a directed
graph that must have no cycle.

## Status machine

```
TRANSITIONS:  active -> retracted
              active -> superseded
              retracted, superseded: terminal (no outgoing edge)
```

No edge leads back to `active`; every row starts as `active`.

## Events

```
event := { fact_id, from, to, replacement, reason }
```

An event is valid against the statuses S at its position (every row active, then each earlier
event applied in order) when:

1. `fact_id` names a row.
2. `from` equals S[fact_id], so an event can only start from the state the previous event left.
3. `from -> to` is an edge of `TRANSITIONS`.
4. `replacement` is non-null exactly when `to = superseded`. A superseded event's replacement
   is a different row (never `fact_id` itself) and S[replacement] is `active`.
5. `reason` is a non-empty string.
6. The event has no other keys.

A writer builds the event with `from` set to the row's current status and checks it with the
same `transitionError` before it appends anything.

## History invariants

For each row, the events naming it form a chain: the first starts at `active`, and each later
`from` equals the previous `to`. This holds for every event, not just the last one. Then:

- The row's `status` equals the `to` of its last event.
- An `active` row has no events. Since no edge returns to `active`, any event leaves the row
  non-active.
- A `retracted` or `superseded` row has at least one event (in fact exactly one, because both
  states are terminal).

Every error message names the fact id it concerns.
