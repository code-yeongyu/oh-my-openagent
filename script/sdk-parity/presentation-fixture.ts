import { gateReport } from "./gate"
import { input, text } from "./gate-fixture"
import type { PresentationRow } from "./presentation"
import type { Outcome } from "./scenario-run"
import { SCENARIOS } from "./scenarios"

// The shared fixture of the presentation controls, built from the real case: train 12 changes one usage line of omo
// remote, `send <session> <text>` to `send <session> <text|->`, with exit codes 0/2/2 unchanged. Base outcomes are the
// pre-change goldens of the three remote scenarios, frozen independently of the live golden registry; both
// capabilities are unresolved, so without the attribution each delta fails.

export const IDS = ["native-remote-help", "native-remote-unknown", "native-remote-open-no-device"]
const scenarios = SCENARIOS.filter((scenario) => IDS.includes(scenario.id))
const committed = JSON.parse(text("script/sdk-parity/presentation-before.fixture.json")) as Record<string, Outcome>
export const base = Object.fromEntries(IDS.map((id) => [id, committed[id] ?? {}]))
export const BEFORE = "  send <session> <text> [--steer|--follow-up] [--no-wait]"
export const AFTER = "  send <session> <text|-> [--steer|--follow-up] [--no-wait]"

export type Edit = (outcome: Outcome, id?: string) => Outcome
export const onStreams =
  (change: (stream: string) => string): Edit =>
  (outcome) => ({ ...outcome, stdout: change(`${outcome["stdout"]}`), stderr: change(`${outcome["stderr"]}`) })
export const train12 = onStreams((stream) => stream.replace(`${BEFORE}\n`, `${AFTER}\n`))
const headWith = (edit: Edit) => Object.fromEntries(IDS.map((id) => [id, edit(base[id] ?? {}, id)]))

export const ROW: PresentationRow = {
  verb: "remote send",
  scenarios: IDS,
  changes: [{ before: BEFORE, after: AFTER }],
  reason: "the text argument also takes - to read the message from stdin; same verb, same exit codes",
}

export const run = (
  edit: Edit,
  rows: readonly PresentationRow[] = [ROW],
  goldens = headWith(edit),
  baseRows: readonly PresentationRow[] = [],
) =>
  gateReport(
    input({
      scenarios,
      base: { ...input().base, outcomes: base },
      head: { ...input().head, outcomes: headWith(edit) },
      presentation: { base: baseRows, head: rows },
      goldens: { base, head: goldens },
    }),
  )
