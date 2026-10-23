import { describe, expect, test } from "bun:test"
import {
  FABLE_55_EFFORTS,
  FABLE_55_LAUNCH,
  FABLE_55_RELEASED,
  type LaunchRungRejection,
  selectLaunchRungs,
} from "./fable-55-launch"
import { LATEST_MODEL_BY_FAMILY } from "./latest-models"
import type { ModelCapabilitiesSnapshotEntry } from "./model-capabilities/types"

// Names every launch value still at its placeholder (undefined), including any field added later.
function unfilledLaunchValues(entry: ModelCapabilitiesSnapshotEntry): string[] {
  const required: Record<string, unknown> = {
    reasoning: entry.reasoning,
    temperature: entry.temperature,
    toolCall: entry.toolCall,
    "modalities.input": entry.modalities?.input,
    "modalities.output": entry.modalities?.output,
    "limit.context": entry.limit?.context,
    "limit.input": entry.limit?.input,
    "limit.output": entry.limit?.output,
  }
  const declared: Record<string, unknown> = { ...entry }
  for (const [key, value] of Object.entries(entry.limit ?? {})) declared[`limit.${key}`] = value
  for (const [key, value] of Object.entries(entry.modalities ?? {})) declared[`modalities.${key}`] = value
  const unfilled = Object.entries({ ...declared, ...required }).filter(([, value]) => value === undefined)
  return unfilled.map(([key]) => key).sort()
}

describe("Fable 5.5 launch values", () => {
  test("a release leaves no launch value at its placeholder", () => {
    // given / when
    const unfilled = FABLE_55_RELEASED ? unfilledLaunchValues(FABLE_55_LAUNCH) : []
    // then
    expect(unfilled).toEqual([])
  })

  test("the placeholder check names every unfilled value and passes a filled entry", () => {
    // given
    const filled: ModelCapabilitiesSnapshotEntry = {
      id: "fixture",
      family: "claude-fable",
      reasoning: true,
      temperature: true,
      toolCall: true,
      modalities: { input: ["text"], output: ["text"] },
      limit: { context: 1, input: 1, output: 1 },
    }
    // when / then
    expect(unfilledLaunchValues(filled)).toEqual([])
    expect(unfilledLaunchValues({ id: "fixture" })).toEqual([
      "limit.context",
      "limit.input",
      "limit.output",
      "modalities.input",
      "modalities.output",
      "reasoning",
      "temperature",
      "toolCall",
    ])
    expect(unfilledLaunchValues({ ...filled, family: undefined })).toEqual(["family"])
  })

  test("a release measures the 5.5 efforts instead of carrying them over from 5.1", () => {
    // given / when / then
    expect(FABLE_55_RELEASED ? FABLE_55_EFFORTS.measured : true).toBe(true)
  })

  test("a released 5.5 rung with an unaccepted effort is dropped and recorded, never thrown", () => {
    // given
    const rungs = [
      { model: "anthropic/claude-fable-5.5", variant: "max" },
      { model: "claude-fable-5-5", variant: "high" },
      { model: "claude-fable-5-5" },
      { model: "claude-fable-5-1", variant: "low" },
    ]
    const rejected: LaunchRungRejection[] = []
    // when (on the pre-fix code this release path threw while the chain tables were built)
    const selected = selectLaunchRungs(rungs, { released: true, accepted: ["xhigh", "max"] }, (r) => rejected.push(r))
    // then
    expect(selected.map((r) => r.model)).toEqual(["anthropic/claude-fable-5.5", "claude-fable-5-1"])
    expect(rejected).toEqual([
      { model: "claude-fable-5-5", variant: "high" },
      { model: "claude-fable-5-5", variant: undefined },
    ])
  })

  test("an unreleased gate drops every 5.5 rung without recording a rejection", () => {
    // given
    const rejected: LaunchRungRejection[] = []
    // when
    const selected = selectLaunchRungs(
      [{ model: "claude-fable-5-5", variant: "max" }, { model: "claude-fable-5-1", variant: "max" }],
      { released: false, accepted: ["max"] },
      (r) => rejected.push(r),
    )
    // then
    expect(selected.map((r) => r.model)).toEqual(["claude-fable-5-1"])
    expect(rejected).toEqual([])
  })

})

describe("Fable 5.5 launch order (#10800 review)", () => {
  test("#given Fable 5.5 is not released #then the latest-model table does not name it yet: moving the table to 5.5 is the POST-launch cleanup step", () => {
    // launchDefaultModelId() returns the table entry until FABLE_55_RELEASED flips; a table already at 5.5 would make the
    // pre-launch default the gated 5.5 id, which every resolver skips. Flip the release first, then move the table.
    expect(FABLE_55_RELEASED || LATEST_MODEL_BY_FAMILY.claudeFable !== FABLE_55_LAUNCH.id).toBe(true)
  })
})
