import type { TableScenario } from "./expectation"
import type { Row } from "./schema"

// Whether the scenario TABLE is valid, kept apart from whether a row is BUILT (design lane ruling on 7.3): a scenario that
// cannot pass yet (a recorded gap such as threads.follow on this device before T1d) still has to exist. The table names,
// for every row with a thread address, an effect scenario on each target (a host-local row: an effect on this device and
// a refusal on another); each id sits under its row and the row's split; an aborting scenario states with count 0 the
// effect that must not have happened; an effect scenario states some port effect; a refusal names its code.

export function tableProblems(rows: readonly Row[], scenarios: readonly TableScenario[]): string[] {
  const problems: string[] = []
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]))
  for (const scenario of scenarios) {
    const at = `scenario ${scenario.id}`
    if (!scenario.id.startsWith(`${scenario.row}/`)) problems.push(`${at}: its id must start with "${scenario.row}/"`)
    const pure = rows.find((row) => row.id === scenario.row)?.pure === true
    // The first call and every `then` step share one contract (review 6062344773); a step's diagnostic names its number.
    const calls = [scenario, ...(scenario.then ?? [])]
    for (const [index, call] of calls.entries()) {
      const where = index === 0 ? at : `${at} step ${index + 1}`
      if (call.kind === "refusal" && call.refusal === undefined)
        problems.push(`${where}: a refusal scenario names its code`)
      if (call.kind !== "refusal" && call.refusal_from !== undefined)
        problems.push(`${where}: refusal_from belongs to a refusal`)
      if (pure && call.kind === "effect" && call.answer === undefined)
        problems.push(`${where}: a pure call's effect scenario states its answer`)
      if (!pure && call.kind === "effect" && call.expect.every((expectation) => (expectation.count ?? 1) === 0))
        problems.push(`${where}: an effect scenario states a port effect; an answer alone builds nothing`)
    }
    if (scenario.abort !== undefined && !scenario.expect.some((expectation) => expectation.count === 0))
      problems.push(`${at}: an aborting scenario states with count 0 the effect that must not have happened`)
  }
  for (const row of rows) {
    for (const [kind, ids] of [
      ["effect", row.scenarios.effect],
      ["refusal", row.scenarios.refusal],
    ] as const)
      for (const id of ids) {
        const scenario = byId.get(id)
        if (scenario === undefined) problems.push(`row ${row.id}: names scenario ${id}, which the table does not have`)
        else if (scenario.row !== row.id || scenario.kind !== kind)
          problems.push(
            `row ${row.id}: lists ${id} under ${kind}, but the table has it as a ${scenario.kind} of ${scenario.row}`,
          )
      }
    const own = scenarios.filter((scenario) => scenario.row === row.id)
    if (own.length === 0 || !Object.hasOwn(row.input.properties, "thread")) continue
    const needed =
      row.addressScope === "this_device"
        ? ([
            ["effect", "this_device"],
            ["refusal", "other_device"],
          ] as const)
        : ([
            ["effect", "this_device"],
            ["effect", "other_device"],
          ] as const)
    for (const [kind, target] of needed)
      if (!own.some((scenario) => scenario.kind === kind && scenario.target === target))
        problems.push(
          `row ${row.id}: the table has no ${kind} scenario on ${target}; write the target contract, even before it can pass`,
        )
  }
  return problems
}
