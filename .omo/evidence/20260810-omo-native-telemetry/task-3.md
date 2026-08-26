# Task 3 evidence: ultrawork classification and arming snapshot

## Scope and commit ordering

The live handler was pinned before `index.ts` changed.

First task commit:

```text
b1e70fb00 test(omo-senpi): pin ultrawork arming behavior before extraction
```

The production file SHA-256 was identical before and after the characterization commit:

```text
54c54c5b0ceef1e95bde464e8cbb05ee7ac79ca5cfa70af0e0f45199d7cbabd3  packages/omo-senpi/src/components/ultrawork/index.ts
```

## Characterization pass on unchanged production code

Baseline command before adding task pins:

```sh
bun test packages/omo-senpi/src/components/ultrawork
```

Real summary:

```text
37 pass
0 fail
182 expect() calls
Ran 37 tests across 2 files. [3.01s]
```

Command after adding only characterization tests, with `index.ts` still byte-identical:

```sh
bun test packages/omo-senpi/src/components/ultrawork
```

Real summary:

```text
39 pass
0 fail
204 expect() calls
Ran 39 tests across 2 files. [1253.00ms]
```

Test count delta: 37 to 39, exactly 2 new characterization tests. The added sequence pins first trigger full directive, same-session reminder, rejected-compaction reminder, and accepted-compaction full directive. The suppression matrix pins `/skill:` prefix suppression, disabled-flag suppression, and `source: "extension"` early return, including an unchanged unarmed ledger.

## Extraction failing-first proof

After adding the extraction contract tests but before adding exports:

```sh
bun test packages/omo-senpi/src/components/ultrawork
```

Real failure:

```text
SyntaxError: Export named 'classifyUltraworkInput' not found in module '.../components/ultrawork/index.ts'.
SyntaxError: Export named 'armingSnapshot' not found in module '.../components/ultrawork/index.ts'.

0 pass
2 fail
2 errors
```

## Post-refactor green

Command:

```sh
bun test packages/omo-senpi/src/components/ultrawork
```

Real summary:

```text
45 pass
0 fail
244 expect() calls
Ran 45 tests across 2 files. [1149.00ms]
```

This includes:

- legacy handler characterization remaining green
- all four stages: `none`, `first_arm`, `remention`, `post_compact_rearm`
- extension suppression with no ledger access from the pure classifier
- accepted-compaction pending state and clear-on-arm behavior
- three repeated `armingSnapshot` reads with identical before and after ledger state
- single shipped-pattern occurrence counts for overlapping and repeated variants

## Parity table test

Command:

```sh
bun test packages/omo-senpi/src/components/ultrawork/ultrawork.test.ts -t "fixed prompt corpus"
```

Real stdout:

```text
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-senpi/src/components/ultrawork/ultrawork.test.ts:
(pass) omo-senpi ultrawork component > #given a fixed prompt corpus #when pure classification runs #then keyword matching stays in parity with the shipped detector [0.74ms]

1 pass
27 filtered out
0 fail
24 expect() calls
Ran 1 test across 1 file. [128.00ms]
```

The fixed 24-string corpus includes all required entries: `ulw-plan`, `ulwultrawork`, `ULW ulw Ultrawork`, `plan only`, `하이ulw`, and `ulw_helper.ts`.

## Adversarial results

The parity corpus and focused tests cover:

| Class | Input or setup | Result |
| --- | --- | --- |
| Empty | empty string | parity false, occurrence count 0 |
| Extremely long | 100,000 `x` characters | parity false without error |
| Regex-special | `.*+?^${}()|[]\\ ulw` | parity true, literal text handled safely |
| Unicode | `하이ulw`, `울트라워크` | embedded ASCII trigger matches; Korean transliteration alone does not |
| Overlap | `ulwultrawork` | `matchedUlw=true`, `matchedUltrawork=true`, occurrence count 2 |
| Repetition | `ULW ulw Ultrawork` | both variants, occurrence count 3 |
| Skill boundary | `ulw-plan` | no match and no arm |
| Stale state | same armed snapshot classified twice | byte-equal classification results, stage `remention` |

Focused stale-state command:

```sh
bun test packages/omo-senpi/src/components/ultrawork/ultrawork.test.ts -t "identical stale snapshots"
```

Real summary:

```text
1 pass
27 filtered out
0 fail
2 expect() calls
Ran 1 test across 1 file. [127.00ms]
```

## Typecheck

Command:

```sh
bun run --cwd packages/omo-senpi typecheck
```

Real stdout:

```text
$ tsgo --noEmit -p tsconfig.json
```

Exit code: 0.

## Manual QA: six canonical prompts

Throwaway script command:

```sh
bun /tmp/omo-task-3-ultrawork-qa.ts
```

Real stdout:

```text
input	occurrenceCount	variant	stage
"ulw ulw ulw plan"	3	ulw	first_arm
"ulw again"	1	ulw	remention
"ulw after compact"	1	ulw	post_compact_rearm
"ulw-plan"	0	none	none
"ulw from extension"	1	ulw	none
"plan only"	0	none	none
```

## Cleanup receipt

Command:

```sh
rm /tmp/omo-task-3-ultrawork-qa.ts && test ! -e /tmp/omo-task-3-ultrawork-qa.ts
```

Real stdout:

```text
cleanup PASS: removed /tmp/omo-task-3-ultrawork-qa.ts
```

No QA process, port, container, or temporary script remains.
