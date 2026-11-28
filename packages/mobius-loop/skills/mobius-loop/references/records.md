# Initiative records

Read `mobius.help()` for the machine-readable contract. All SDK methods return
envelopes. After a successful `start`, `status`, or `record`, the current revision
is `result.snapshot.revision`. Keep mutation calls sequential and inspect each
result before proposing the next event.

```js
const current = await mobius.status()
if (current.ok) {
  print(await mobius.record({
    expectedRevision: current.result.snapshot.revision,
    event: {
      type: "outcome",
      id: "diagnosis-time",
      statement: "Installers identify the failed prerequisite sooner",
      baseline: "Median 12 minutes in the observed support cases",
      target: "Median at most 4 minutes",
      measure: "Time five new installers from failure to correct diagnosis",
    },
  }))
}
```

The values above illustrate record shape; obtain the actual baseline, affected
people, authorization, and measurements from the current project.

## Event fields

| Type | Fields after `type` | Meaning |
| --- | --- | --- |
| `context` | `problem`, `people: [{ name, role }]`, `unknowns: string[]` | Current understanding; role is `affected`, `stakeholder`, `decider`, or `executor` |
| `outcome` | `id`, `statement`, optional `baseline`, `target`, `measure` | Intended impact; updating the id's definition invalidates its old resolution |
| `option` | `id`, `title`, `hypothesis`, `tradeoffs: string[]`, `outcomeIds`, optional `supersedes` | A retained alternative linked to existing outcomes |
| `decision` | `optionId`, `rationale`, `decidedBy`, `refs` | The currently selected route and its authority |
| `experiment` | `id`, `optionId`, `plan`, `passCriteria`, optional `deliveryRef` | A bounded test of the selected option |
| `delivery` | `experimentId`, `output`, `checks: [{ name, status, evidence }]`, `refs` | Delivered output and technical checks; check status is `pass`, `fail`, or `blocked` |
| `evidence` | `id`, `experimentId`, `kind`, `provenance`, `source: { actor, role }`, `summary`, `refs`, optional `outcomeId` | A sourced observation, simulation, or inference |
| `assessment` | `experimentId`, `validity`, `hypothesisSupport`, `outcomes: [{ outcomeId, status, evidenceIds }]`, `learning`, `nextAction` | Independent experiment, hypothesis, and impact judgments |
| `foundation` | `id`, `area`, `note`, `owner`, `status`, `refs` | Continuing support; update by id |
| `focus` | `to`, `reason`, `refs` | Move to `discover`, `decide`, or `deliver` |
| `pause`, `resume` | `reason` | Suspend or resume the initiative |
| `close` | `reason`, `resolution`, `evidenceIds` | End with `achieved`, `irrelevant`, or `stopped` |

Evidence `kind` is `measurement`, `feedback`, or `technical`; provenance is
`observed`, `simulated`, or `inferred`. Name the source actor and role. Reference
existing evidence ids in assessments and closure; use `refs` for citations to
source messages, artifacts, URLs, or delivery records. The SDK records citations
without fetching them or attesting that their contents are true.

Assessment `validity` is `valid`, `invalid`, or `unknown`.
`hypothesisSupport` is `supported`, `contradicted`, or `inconclusive`.
Outcome status is `achieved`, `not_achieved`, `unmeasured`, or `irrelevant`.
Only a valid experiment with observed outcome measurements or feedback can
establish achievement. A technical check or simulated user cannot establish it.

Foundation `area` is `culture`, `collaboration`, or `technical`; status is
`open` or `done`. Its records remain available regardless of focus.

## Link a delivery

Use the real identifiers returned by the existing delivery SDK:

```js
const deliveryRef = {
  kind: "ulw-loop",
  sessionId: deliverySessionId,
  goalId: deliveryGoalId,
}
```

Attach this to an `experiment` event. The link records where the work runs;
it does not create, complete, or edit that goal. Follow the loaded `ulw-loop`
skill's contract for evidence and checkpointing. A completed delivery still needs
an impact assessment in Mobius.

## Recovery and scope

Choose the same project directory and slug in a later session, then call
`status()`. Read the event history and next actions before continuing. The latest
context, outcome definitions, decisions, and assessments determine the current
view; earlier records remain available.

Use a new experiment id for another attempt and a new option id when changing
the approach. Changing focus is independent of adding evidence. Paused work
requires a `resume` event before further work; closed initiatives remain a
record. Start a new bounded initiative for a new purpose.

On malformed state or an abandoned lock, retain the files and diagnose the
interrupted writer. The SDK never guesses that an owner is dead or destroys the
record to recover. Its generated state is ignored under its own storage root.

## Learning handoff

`learning({ experimentId })` returns a description and body prepared from an
assessment. Review its evidence and uncertainty. Pass those values to the
existing memory tool, which owns frontmatter, locking, and memory commits.
Keep project lessons scoped to the project and include their source references.
