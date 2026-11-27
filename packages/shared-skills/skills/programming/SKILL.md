---
name: programming
description: "Applies strict, modern language practice (typed errors, exhaustive match, tests that can fail) for Python, Rust, TypeScript, JavaScript, and Go. Use for work on .py, .rs, .ts, .js, or .go files, and whenever a test or spec file is written, reshaped, reviewed, or deleted: the four-question test authoring gate and the junk-test classes live here."
---

# Programming

**You own this code.** What it is for and how it is built are your call, so change it the way its owner would: fit new behavior into the structure that is there and leave no duplicate or dead code behind. **A defect in the code you are changing is yours to fix now, at its root cause; never excuse it as pre-existing, someone else's, or the tool's fault.** One elsewhere goes in your summary as a follow-up.

## 1. LANGUAGE GATE: READ BEFORE THE FIRST LINE OF CODE

This file holds what every language shares. Each README holds that language's hard rules, canonical libraries, toolchain, CI gate, scaffolder, and the table of references to load per task. Read the README, then the files its table names for the work. Manifests and tool configs follow their language's row. One-off scripts get the same discipline: `uv run` + PEP 723, `rust-script`, `bun run`, and `go run` make it free.

| Touching | Read |
|---|---|
| `.py`, `.pyi` | `references/python/README.md` |
| `.rs`, `Cargo.toml` | `references/rust/README.md`. **`unsafe`, `*mut`, `*const`, `MaybeUninit`, FFI, `unsafe impl Send/Sync`, or a custom lock-free primitive: ALSO every file under `references/rust-ub/`.** |
| `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` | `references/typescript/README.md` |
| `.go`, `go.mod`, `.golangci.yml`, `*.proto` next to a Go module | `references/go/README.md` |
| a test file, or a change that adds, reshapes, or deletes a test | the language row PLUS `references/testing/README.md` (the authoring gate) and `references/testing/junk-classes.md` (the table the gate reviewer applies) |
| log lines, logger setup, a service entrypoint, an error boundary | `references/logging.md`. The project's existing practice wins: its designated logger and nothing else, and no logging in a project that does not log. |
| a rendered web surface: `.html`, `.css`, `.jsx`, `.tsx`, `.vue`, `.svelte`, `.astro`, or any task that ships a UI | the language row, if any, PLUS the `frontend` skill, before the first line of UI code. With no design direction (no named brand, reference image or site, `DESIGN.md`, or existing styled UI to match), take the look from its references; never improvise one. The UI is done only after the `visual-qa` skill passes on the real rendered surface. |

## 2. AXIOMS

Every recipe under `references/` derives from these.

0. **The best code is the code never written.** Stop at the first rung that holds: does this need to exist (YAGNI)? Does this codebase already have it? The standard library? A platform feature? An installed dependency? One line? Only then write the minimum that works, with no helper, class, or trait for a single caller. Climb the ladder after tracing the real flow end to end: the smallest diff in the wrong place is a second bug. A ticket names a symptom; grep every caller of the function you touch and fix the shared seam once, because a guard per caller leaves a sibling caller broken.
1. **Deep modules: every decision has ONE owner.** A module earns its boundary by hiding a decision (a format, a protocol, a storage layout, a policy) behind an interface smaller than what it hides. Knowledge two modules both hold is a leak: changing it must touch one place. Remove pass-through layers and wrappers that only rename. Split along the decision each piece hides, never by size or by execution order.
2. **Decisions in the core, effects at the edge.** Domain logic takes values and returns values. I/O, the clock, randomness, and the environment are read at the edge and passed in. Dependencies point from the edge toward the domain, never back, so the core is testable without mocks.
3. **The type system is your proof system.** Make illegal states unrepresentable. A bug that can be a type error is REQUIRED to be one.
4. **Parse, don't validate.** Untrusted input is parsed into a typed value once, at the boundary. Inside, code receives typed values and never re-validates.
5. **One name = one concept.** A `UserId` is not a `string`; `Seconds` is not `Milliseconds`. Every distinct semantic primitive gets a newtype or branded type, so the compiler refuses to mix them.
6. **Exhaustive variant matching, always.** A tagged variant is matched exhaustively with an unreachable check the compiler or linter enforces. **`if`/`else` chains on a variant are FORBIDDEN**: they silently swallow new variants.
7. **Trust guarantees; validate only at boundaries.** No null check for a value the types prove non-null. No `try` around code that cannot raise. No escape hatch (`Any`, `as`, `!`, `unwrap`, a suppression comment) to paper over a contract the types should carry. No defensive layer for a scenario you cannot name.
8. **State and failure are explicit.** Immutable by default; parameters are inputs, so produce a new value. Errors are typed values, never bare strings, caught only where they are handled or at the top-level boundary, never swallowed. Resources are released by scope. Concurrency is structured and cancellable. A client left on bare defaults (no timeout, no pool limit, no schema) is a bug.
9. **Tests are the behavior of record, and only tests that can fail count.** READ the tests covering the area BEFORE you change it: do they encode the intent, cover this path, pass? One wrong before your change is a FINDING; never edit it green, never delete it to unblock a run. Reproduce a bug before fixing it. Add a test ONLY where the repository keeps tests for this behavior AND a regression would otherwise pass unnoticed, sized like its neighbors, after answering the four-question gate in `references/testing/README.md`.

## 3. SMELLS: STOP AND FIX

Fix each, or carry it with a SPECIFIC stated reason. Rationale, workaround detection, and split examples: `references/code-smells.md`.

| Smell | Fires when | Fix |
|---|---|---|
| 1. Oversized file | **>250 pure LOC (non-blank, non-comment) is a DEFECT.** 200-250: say so and propose a split if the next edit adds lines. | Name what the file owns in one noun phrase; if it needs "and", split it (axiom 1) before adding lines. Indivisible (generated parser, state machine, pure data table): mark the first 10 lines `# noqa: SIZE_OK — <reason>` in Python or `// allow: SIZE_OK — <reason>` elsewhere. |
| 2. Parameter bloat | A function takes >3 parameters, or smuggles them through a dict, `**kwargs`, `...args`, or a throwaway options object. | Group related parameters into a typed value object with a domain name. |
| 3. Redundant verification | Code deletes, writes, inserts, or sets, then re-reads to "confirm". | Delete the check: the operation's contract IS the verification. If it can fail silently, fix the operation. |
| 4. Negative names | `isNotValid`, `noErrors`, `DisableLogging`. | Rename to the positive form and invert the branch. Guard clauses and filters keep their negation. |

## 4. DEPENDENCY UPGRADES

- **`0.x` minor = major.** Treat `0.N → 0.N+1` as breaking: read the changelog, build, and run the full suite before trusting it.
- **Version literals live outside the manifest.** Before committing a bump, grep the repo for the old version string: Dockerfiles, CI workflows, and docs carry copies, and a manifest-only bump ships a split-brain deploy.
- **Never hand-merge a lockfile.** On conflict, take either side whole and regenerate with the package manager.

## 5. AFTER WRITING: REVIEW BEFORE YOU CLAIM DONE

1. **Measure every file you created or changed.** `awk '!/^[[:space:]]*$/ && !/^[[:space:]]*(\/\/|#|--)/' <file> | wc -l`, or the shipped checker for the language:

   ```bash
   uv run scripts/python/check-no-excuse-rules.py <paths>
   bash scripts/rust/check-no-excuse-rules.sh <paths>
   bun run scripts/typescript/check-no-excuse-rules.ts <paths>
   bash scripts/go/check-no-excuse-rules.sh <paths>
   bun run scripts/typescript/check-test-junk.ts <test paths>   # any language
   ```

2. **Re-read your diff against every axiom and smell above**, and state in your reply which you carried and why. A test you added or reshaped must go red when its production owner breaks and match no row of `references/testing/junk-classes.md`.
3. **Fix every failure before declaring done.** When a smell fired or the review found more than two issues, load the `refactor` skill and run its protocol; never improvise a structural change. When the branch carries AI-authored patterns (broad catch, dead helpers, junk tests, vague comments), load the `remove-ai-slops` skill.
