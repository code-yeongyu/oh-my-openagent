import { expect, test } from "bun:test"
import type { setup } from "../bin/lib/install-calls.js"
import {
  type SetupCountEntry,
  type SetupPlanEntry,
  type SetupStageId,
  setupEntryText,
} from "../bin/lib/setup-stream.js"

// The setup calls' stage ids and entry keys are closed sets (slice C1c review): the typecheck of this file rejects an
// invented key, a value of the wrong kind and a stage the setup does not have.

type Decide = NonNullable<Parameters<typeof setup.apply>[0]["decide"]>
type Applied = Extract<Awaited<ReturnType<typeof setup.apply>>, { kind: "ok" }>["value"]
type Planned = Extract<Awaited<ReturnType<typeof setup.plan>>, { kind: "ok" }>["value"]

const listed: SetupPlanEntry = { key: "planned-add", value: ["google"] }
const counted: SetupCountEntry = { key: "imported", value: 1 }
const stage: SetupStageId = "model-choices"
const decided: Parameters<Decide>[0]["id"] = "assets"
const applied: Applied["applied"][number] = "providers"
const planned: Planned["stages"][number]["id"] = "credentials"

// @ts-expect-error a key no stage reports
const invented: SetupPlanEntry = { key: "planned-everything", value: [] }
// @ts-expect-error a list key given a number
const listAsNumber: SetupPlanEntry = { key: "planned-add", value: 1 }
// @ts-expect-error a count key given a list
const countAsList: SetupCountEntry = { key: "imported", value: ["google"] }
// @ts-expect-error a stage the setup does not have
const unknownStage: SetupStageId = "extensions"
// @ts-expect-error decide is asked about the setup's own stages only
const decidedUnknown: Parameters<Decide>[0]["id"] = "everything"
// @ts-expect-error an apply answers the setup's own stage ids only
const appliedUnknown: Applied["skipped"][number] = "everything"

test("#given each entry kind #then setupEntryText keeps the bytes omo setup prints", () => {
  expect([listed, { key: "skipped-oauth", value: [] } satisfies SetupPlanEntry, counted].map(setupEntryText)).toEqual([
    "planned-add: google",
    "skipped-oauth: none",
    "imported: 1",
  ])
  expect([
    stage,
    decided,
    applied,
    planned,
    invented,
    listAsNumber,
    countAsList,
    unknownStage,
    decidedUnknown,
    appliedUnknown,
  ]).toHaveLength(10)
})
