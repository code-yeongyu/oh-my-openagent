# Unit rules for derived facts

The one definition of which unit a derived or converted fact row carries, and the reviewer's checklist for
`scripts/unit-rules.mjs`. ONE registry (`OPERATION_RULES`) owns, per operation: arity, operand-unit guards, context
fields, result-unit inference, and malformed shapes. `derive()` (`fact-derive.mjs`) and `recompute()`
(`fact-recompute.mjs`) both call it; neither has op-specific unit code. `row.unit` is NEVER used to choose arithmetic;
numeric guards may read `exact` values, unit selection may not. The property tests in
`scripts/fact-unit-rules.test.ts` iterate the registry, so a new operation needs a table row here and cases there.

## Units
- Canonical unit text is stored and compared exactly (case-sensitive symbols). Registered aliases
  (`pp` -> `%p`, `kilometre` -> `km`, ...) are canonicalized ONLY at input (derive/fact add); a relabel to an alias
  at rest is a relabel and is detected. Unit text with no alias is stored as given: whitespace is trimmed only around
  `*`, `/`, `^`, and parentheses, so `million people`, `metric ton`, and `USD per person` keep their inner spaces.
- A scale word (`million`, `M`, `bn`, `billion`, `thousand`, `e6`, ...; the `scale` rows of `units.mjs`) is a
  multiplier, not a unit, and denomination scaling is out of scope, so it never becomes a unit atom: `million`,
  `USD/M`, and `million*person` are refused at input (derive, and every operand read). Either store the scaled numeral
  in the counted unit (5 million people as `5000000 person`) or keep the whole phrase as plain unit text:
  `million people` has no table alias as a whole, so it is stored as given and sums only with `million people`, never
  with `person`.
- `null` = dimensionless. Omitted unit on a derived spec is an error, not null (distinguish omission from declared null).
- Percent `%` stores percentage numerals (20% stores 20). Delta `%p` (percentage points). 1 basis point = 0.01 %p
  (input alias `bp` -> `%p` with /100 scaling).
- Composite units are canonical algebraic strings built by the registry (`USD/kg`, `person`), never by concatenating
  operand strings: equal factors cancel (`USD/(USD/person)` -> `person`).
- Affine scales (temperature: `C`, `F`) are flagged in the unit table; sum/diff/growth/share/ratio and every expr
  node refuse them (temperatures are not summed or differenced as absolute values); only convert takes them.
  Affine atoms in composites are refused before cancellation. Exponents are exact signed bigint integers, including zero.

## Operation table

| op | arity | operand guards | context fields (persisted on the row) | result unit | malformed -> recompute ok:false |
|---|---|---|---|---|---|
| sum | n>=2 | non-affine units, all equal after canonicalization; if `%`: `disjoint: true` AND `reference` (one denominator id/text) equal on every operand AND rationale | disjoint, reference, rationale | the common unit (`%` stays `%`) | <2 operands; missing id; no context; unequal/affine units; `%` without disjoint, reference, or rationale |
| diff | 2 | non-affine units; typed pairs only: U-U -> U (same non-% unit); %-% -> `%p`; %-%p -> `%`; %p-%p -> `%p`; %p-% REFUSED | none | per the pair rule | arity; invalid pair (`%p - %`, `m - person`); affine units; stray context |
| growth | 2 (from,to) | equal non-affine units; same entity; two different valid_at; from.exact > 0 | none | `%` (= 100(to-from)/from) | arity; unequal/affine units; entity/valid_at; from<=0; stray context |
| share | 2 (part,whole) | equal non-affine units; whole.exact > 0; 0 <= part <= whole | none | `%` (= 100 part/whole) | arity; units; whole<=0; part outside [0,whole]; stray context |
| ratio | 2 (num,den) | non-affine units; den.exact != 0; unequal `%`/`%p` REFUSED | none | registry composite: equal units -> null; else canonical `U(num)/U(den)` with cancellation | arity; den=0; stray context |
| convert | 1 | U(a) has a registered factor to `target`; currencies REFUSED (use expr with a dated rate row) | target (persisted as canonical text; the ONLY accepted declared unit; `row.unit` is compared to it exactly, never canonicalized at rest) | the persisted target | arity; no context; target missing; target not canonical (an alias at rest); currency target; no factor; declared unit != persisted target |
| expr | n>=1 | formula ids == operand set; node rules: `+`/`-` follow the sum/diff typed-pair rules, affine refusal included (so `20% - 10%` is `%p`, never `%`, and `25 C + 30 C` is refused); `+` also takes `%` + `%p` in either order -> `%` (as diff's `%-%p`), while `%` + `%` is refused (use sum); `*` and `/` compose canonical composites, `%`/`%p` operands normalize by /100 to dimensionless first; result must be fully inferred: NO rationale escape | none | the inferred unit; an explicit null->`%` conversion is a separate `convert`-like node (`pct()`) | formula/operand id mismatch; parse error; /0; uninferable unit; affine operands; stray context |

Every row's malformed column also holds the two operand-identity shapes below (`repeated operand`, `self reference`).

## Operand identity (applies to every row)
- Operand ids are DISTINCT within one derived row. sum of F1, F1 is not a sum of two shares, and diff, ratio, share,
  growth, or convert of an operand with itself is meaningless and would dodge every pair guard. A repeated id is
  refused by `derive()` (`operand F1 is repeated`) and is `ok:false` at `recompute()` (malformed shape
  `repeated operand`). The check sits in the registry (`expectedUnit` and `malformed`), so no operation can skip it.
- expr may reference the same id in several leaves (`F1 * F1` is a legitimate square). Its stored operand list is the
  formula's id SET, which must equal the formula ids (`formula id mismatch`); an id listed twice in that list is the
  `repeated operand` shape too.
- A derived row may not cite itself, directly (`self reference`: its own id among its operands) or through nested
  derived operands (a cycle). `recompute()` refuses both. `derive()` recomputes every derived operand first and
  refuses one that does not recompute (tampered, cyclic, or self-citing), so nothing is built on such a row.

## Invariants (property tests iterate the table)
1. For each op: generate valid typed operands (rational boundaries, aliases at input, composites, %/%p, affine,
   metadata, conversion targets, repeated expr refs), derive, assert `recompute(row).ok === true`.
2. Relabel: for each op, set `unit` to every different canonical string/null (incl. aliases and other valid targets),
   regenerate render, keep exact: `recompute(row).ok === false` naming the expected unit; and `derive()` with that
   declared unit is refused.
3. Malformed: per op, every shape in the table's malformed column has one case, named in the registry's
   `OPERATION_RULES[op].malformed` list (the test asserts its case names equal that list): `recompute` returns
   `ok:false` for that shape's own reason, never throws.
4. Nested derived rows are verified recursively (operands may be derived rows); cycles and self references are
   refused, by `recompute()` and by `derive()` before it builds on a derived operand.
5. Render precision (`renderPrecision` in `unit-rules.mjs`): fewest decimal places for sum, diff, an expr whose root
   node is `+` or `-`, and every `%p` result; fewest significant figures otherwise (an expr `*` or `/` root with a
   non-`%p` result included). Operand values and expr literals both count.

## Decisions
- Q1: the canonical composite goes in `unit` (consumers compare `unit` text); no side field.
- Q2: expr with an unresolved unit is REFUSED; a known-unit `a*b/c` is inferable, so no rationale escape exists.
- Q3: canonical `%p`, input alias `pp` (matches units.mjs).
- Q4: strict null metadata: null matches only null; required metadata must be present.

## Out of scope (follow-ups)
Per-capita identity, named index/base and index-point differences, weighted means, dated FX / nominal-real bases,
same-currency denomination scaling (M/B), summing ratios over a common base. Each needs its own table row + tests.

## Dimensions

1. Enforced: kind and operation agree; a changed discriminator cannot disable recursive verification.
2. Enforced: expression and direct arithmetic check population, snapshot, and accounting metadata; common metadata propagates.
3. Enforced: stored `precision: { places, sigfigs }` carries operand precision independently of display trailing zeros.
4. Enforced: scaled aliases normalize at every composite factor and exponent, scaling the input numeral exactly.
5. Enforced: derive and recompute return classified refusals with `shape`, `expected`, and `detail`; derive never appends on refusal.
6. Enforced: aliases canonicalize at input; noncanonical stored results and conversion targets are refused, and a source unit that needs rescaling (a scaled alias) is refused as an operand.
7. Enforced: stored rationals are reduced integer strings with positive denominators and canonical zero.
8. Enforced: operation contexts have closed keys and types, including non-percent sums and context-free operations.
9. Enforced: formula, factor, derived_from, raw, render, metadata, precision, and compatibility are compared on replay.
10. Enforced: metadata object equality ignores key insertion order; missing and invalid metadata never equal explicit null.
11. Enforced: new derivations require active transitive dependencies; historical arithmetic remains reproducible after retraction.
12. Enforced: graph and expression traversal use explicit stacks; shared nodes are evaluated once per verification.
13. Enforced: factor exponents use bigint, preserve grouping and quotient direction, and canonicalize idempotently.
14. Enforced: affine atoms cannot hide in composites or cancellation; scale words are never unit atoms.
15. Enforced: disjoint percentage shares are individually in [0,100], total at most 100, and use exactly one reference.
16. Enforced: currency table conversion is refused; FX expressions require a dated rate and persist compatibility `unchecked`.
17. Enforced: symbols are case-sensitive; only registered spelling aliases normalize; opaque Unicode and phrases stay distinct.
18. Enforced: missing, undefined, and empty required fields do not substitute for explicit null; zero remains valid.
19. Enforced: identifiers allocate exactly beyond 2^53 using bigint; operand lists remain distinct.
20. Enforced: a supplied expression operand list must equal the formula's unique leaf set.
21. Enforced: additive expression roots and percentage-point results use decimal places; other roots count literal significant figures.
22. Enforced: cloned snapshots with the same spec and timestamp produce identical rows; replay appends a new identity.
23. Documented limitation: coherent rewrites of trusted operands, context, and all dependent audit fields require external provenance to detect.
24. Enforced: arity belongs to each table row; sums are permutation-invariant while ordered operations keep positional meaning.
25. Enforced: denominators, positive growth starts, and bounded shares obey numeric domains; ordinary negative arithmetic remains valid.
26. Enforced: percent, percentage-point, and fraction semantics follow typed pairs, multiplicative normalization, and explicit pct nodes.
27. Enforced: table factors and affine offsets compose exactly; unknown and cross-dimension conversions are refused.
28. Enforced: only decimal literals, fact identifiers, binary arithmetic, parentheses, and pct parse; unsupported syntax is refused.
29. Enforced: rounding is half away from zero; values are plain decimals and display uses canonical units and grouping.
30. Enforced: seeded factor trees and conversion compositions have expected values computed independently of OPERATION_RULES.
31. Enforced: a ledger written before `context`, `precision`, and `compatibility` existed still loads and accepts new derivations. On measured, quote, and assumed rows a missing column reads as null, and a registered alias unit is canonicalized on read (unknown or scaled text stays as given); the file changes only on the next write. Derived and converted rows without those columns load, but `recompute` reports shape `legacy derived row` and `derive` refuses them as operands with the same shape until they are regenerated.
32. Enforced: value/exact agreement. When a row stores both, `exact` must equal `value` at the value's decimal places; a legacy row that disagrees loads and is flagged `dimension 32`, and `addRow` refuses a new one.

## Precedence: dimension 31 wins at read time

Anything dev's shipped writer could write loads and validates. Every row is first read through `readRow`: exacts that
are integer pairs are reduced (sign on the numerator, no leading zeros, positive denominator), decimal values lose
leading zeros, and source rows get canonical units and null later columns. Measured exacts stay as stored because they
are always the reduced exact of `value`. Only then do the strict dimensions run. They apply in full to derived and
converted rows that carry this version's columns, and to every row this version writes. A source row that loads but
still breaks a strict rule (a scale word as unit, empty metadata, an operation or derivation fields) is flagged when it
is used: `derive` and `recompute` refuse it with shape `dimension 6`, `dimension 18`, or `dimension 1`, and `addRow`
refuses to write a new one. Normalization never strips user data: an `exact` carrying keys beyond `num` and `den` is left exactly as written and flagged `dimension 7` on use, never silently reduced to `{ num, den }`. Reading a normalized file again changes nothing. The legacy test fixture is generated by
dev's own `addRow` (`scripts/tests/fixtures/fidelity/gen-legacy-dev.mjs`, which pins the dev commit).

## Trust boundary

Recomputation verifies arithmetic against the ledger's trusted operands and operation context, not against an external
immutable source. A zero-metre conversion rewritten from km to cm together with its target, formula, factor, precision,
and display is indistinguishable from an honestly generated cm conversion. Single-field relabels are detected; a coherent
rewrite needs an immutable ledger baseline or source provenance outside this arithmetic verifier.

Rows carry no per-row schema marker, so a current derived row with `context`, `precision`, and `compatibility` all
deleted reads as a legacy row: `validateLedger` skips its at-rest unit and row-shape checks, and a relabeled unit on
it passes validation. It never becomes trusted again: `recompute` and `derive` refuse it as `legacy derived row`.

## Implementation notes

- Context fields live in the row's `context` column (null or an object on derived and converted rows, always null on
  measured, quote, and assumed rows: a `KIND_RULES` column):
  sum stores `{ disjoint, reference }`, convert stores `{ target }`. The sum rationale stays in `rationale`.
  Schema and recomputation both require the operation's context. Context-free rows carry explicit null.
- `schemaVersion` remains 1. A derived or converted row from an older writer (no `context`, `precision`, or
  `compatibility`) is kept as written and never used as an operand: regenerate it with `derive` to carry precision,
  compatibility, and complete audit fields. Older source rows need nothing: they are read with null later columns.
- `reference` is either one text (the caller asserts one shared denominator) or a map from each operand id to its
  denominator; the map passes only when every operand names the same non-empty denominator.
- `addRow` canonicalizes source units and scales alias numerals, including `100 bp/person` to `1 %p/person`.
  At rest, source-row aliases are canonicalized on read (dimension 31); current derived rows with alias units are refused. A declared result unit with a nontrivial alias scale is refused.
  Scale exponents with absolute value above 10000 are explicitly refused instead of allocating an unbounded numeral.
- A ratio over `%` or `%p` operands with unequal units is refused (use expr, where `%` enters `*` and `/` as a fraction).
- convert reads its target from `to`; a declared `unit` is optional and must equal that target.
- expr persists compatibility `unchecked` on the row as well as returning it. Population, snapshot, and accounting
  predicates apply; a currency-rate operand needs a nonempty `valid_at`. This is arithmetic and unit verification,
  not a guarantee of rate freshness, matching dates, population identity, or financial comparability.
