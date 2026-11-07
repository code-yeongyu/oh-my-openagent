---
name: mobius-loop
description: "Run the Open Practice Library Mobius Loop: discover desired outcomes, decide among options, deliver experiments, and use measured impact and stakeholder feedback to choose the next move. Use for mobius-loop, outcome-driven discovery, revising product direction, or resuming a durable initiative."
argument-hint: "<initiative or resume slug>"
---

# Mobius Loop

Work toward a bounded outcome through Discover, Decide, and Deliver. Foundation
supports all three. Move to the focus the evidence calls for; preserve previous
work when changing direction. Read [the model](references/model.md) before the
first initiative. Read [the record contract](references/records.md) when recording
a new kind of evidence or recovering an interrupted initiative.

## Start or resume

Resolve this skill's directory from its loaded `SKILL.md` location. Expand an
`rN/` prefix through the corresponding `<skill_roots>` entry. Import the actual
absolute `scripts/mobius.mjs` path in a JS eval cell; no SDK-root environment
variable is required. Keep the imported factory for later cells.

```js
const { createMobius } = await import(`${skillRoot}/scripts/mobius.mjs`)
const mobius = createMobius({ cwd: projectDirectory, slug: "install-diagnosis" })
print(await mobius.status())
```

Here `skillRoot` is the resolved skill directory and `projectDirectory` is the
project's absolute working directory. Select a short, stable slug for this
initiative. On a missing initiative, call
`mobius.start({ title: "Reduce installation diagnosis time" })`. Existing work
resumes through `status()`, including after a kernel restart or compaction.
`help()` returns exact method and event contracts and the module URL.

Every method returns an envelope. Inspect `ok`, then `result` and `nextActions`;
on failure, branch on `error.code`. Mutate through
`record({ expectedRevision, event })`, using the revision from the latest status.
For a revision conflict, read the winning state and reconsider the proposed
event. A busy lock means another writer owns the mutation; coordinate with it.
Preserve malformed files for diagnosis. Never repair state by overwriting it.

The initiative persists under `.omo/mobius/<slug>/`. Its event history is the
decision record. The SDK writes only there; execution, goals, and memory retain
their existing owners.

## Choose the next move

1. **Discover.** Establish the problem, affected people, decision authority, and
   desired change. Record outcomes separately from proposed outputs. Capture
   baseline, target, and measurement method when known; keep missing answers in
   `context.unknowns`. Research what the project can answer. Ask a person only
   for information or authority the work cannot supply.
2. **Decide.** Compare plausible options against the outcomes. Record their
   hypotheses and tradeoffs, then the selected option, rationale, and decision
   owner. Reuse prior evidence and authorized choices. Name a new option when
   revising one, with `supersedes` pointing to the old option.
3. **Deliver.** Define the smallest useful experiment or delivery slice for the
   selected option, its pass criteria, and the evidence to collect. Use native
   execution tools and the existing `ulw-loop` skill for durable delivery. Read
   that skill before using its SDK. Store its real session and goal identifiers
   in the experiment's `deliveryRef`; leave execution state with its SDK.
4. **Review learning and impact.** Record the output and technical checks
   separately from outcome measurements and feedback. Identify who supplied
   feedback and label evidence `observed`, `simulated`, or `inferred`. Assess
   experiment validity, hypothesis support, and each outcome independently.
   Record the lesson and next evidence action.
5. **Follow the evidence.** Continue delivery, select another option, or return
   to discovery with a reason and evidence references. A valid experiment that
   contradicts its hypothesis still produces useful learning. Missing impact
   evidence means unmeasured, even when every implementation check passed.

Foundation is available during every step: record cultural, collaboration, and
technical improvements with an owner and follow-through. A Foundation update
does not change focus. Use [optional practices](references/practices.md) only
when they answer the current need.

## Evidence and completion

Collect evidence from the actual surface the outcome concerns. Label a
simulation as a simulation. Keep references to source messages, observations,
measurement artifacts, or delivery checkpoints so another session can inspect
them. A recorded reference is a citation, not automatic proof of its contents.

Only observed measurement or feedback tied to an outcome can support its
achievement. Technical checks establish delivery readiness. When user impact
cannot yet be measured, report delivery readiness and the pending measurement;
pause with a next action rather than inventing impact or continuing forever.

Use `close` with resolution `achieved` only when all current outcomes have
evidence-backed resolutions. Changed targets require a new assessment. Use
`irrelevant` for evidence-backed changes in purpose, or `stopped` when the
initiative is cancelled without a success claim. Respect the user's stop or
redirect immediately.

## Retain useful learning

Call `learning({ experimentId })` after an assessment. Inspect its description,
body, evidence, and uncertainty, then save supported lessons through the existing
`memory` tool with `source: "agent"` and a project-appropriate path. The SDK does
not write memory or change team instructions. Follow the memory tool's rules
for direct user statements and provenance.

Propose shared `AGENTS.md`, rule, or skill changes separately through the
repository's normal review process. Keep session-specific observations in the
initiative record; promote reusable lessons with their limits and sources.
