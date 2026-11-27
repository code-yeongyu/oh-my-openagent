import { describe, expect, test } from "bun:test"

import { ORIGINAL_PATH, PIN_PATH, UNRESOLVED_PATH } from "./baseline"
import {
  type BaseReader,
  GOLDENS_PATH,
  OFFENDERS_PATH,
  PRESENTATION_PATH,
  readBaseInputs,
  ROWS_DIR_PATH,
  SCENARIO_TABLE_PATH,
} from "./base-inputs"

// Security contract (the follow-up to #15208): a merge-base read that fails is a failure of the check, never "the merge
// base has none". Each input is failed in turn, so a catch that swallows one input's failure turns its case red.
const ROW_FILE = `${ROWS_DIR_PATH}threads.json`
const PRESENT: Readonly<Record<string, string>> = {
  [ROWS_DIR_PATH]: "threads.json\n",
  [ROW_FILE]: '{"domain":"threads","rows":[]}',
  [SCENARIO_TABLE_PATH]: "export const SCENARIOS = []\n",
  [UNRESOLVED_PATH]: '{"version":1,"entries":[]}',
  [GOLDENS_PATH]: "{}",
  [PRESENTATION_PATH]: "[]",
  [OFFENDERS_PATH]: "[]",
  [ORIGINAL_PATH]: '{"version":1,"entries":[]}',
  [PIN_PATH]: "pin",
}
const failingOn =
  (path: string): BaseReader =>
  (_ref, read) => {
    if (read === path) throw new Error(`git failed reading ${read}`)
    return PRESENT[read]
  }

describe("the merge-base inputs", () => {
  test("#given every input present #then each is read", () => {
    expect(readBaseInputs((_ref, path) => PRESENT[path], "base")).toEqual({
      rows: [JSON.parse(PRESENT[ROW_FILE] ?? "")],
      scenarioTable: true,
      unresolvedText: PRESENT[UNRESOLVED_PATH],
      goldensText: "{}",
      presentationText: "[]",
      offendersText: "[]",
      originalText: PRESENT[ORIGINAL_PATH],
      pinText: "pin",
    })
  })

  test("#given a merge base with none of them #then each reads as absent", () => {
    expect(readBaseInputs(() => undefined, "base")).toEqual({
      rows: undefined,
      scenarioTable: false,
      unresolvedText: undefined,
      goldensText: undefined,
      presentationText: undefined,
      offendersText: undefined,
      originalText: undefined,
      pinText: undefined,
    })
  })

  for (const path of Object.keys(PRESENT))
    test(`#given the read of ${path} fails #then reading the merge base fails with it, never as absent`, () => {
      expect(() => readBaseInputs(failingOn(path), "base")).toThrow(`git failed reading ${path}`)
    })

  test("#given the unresolved list's read fails #then no inputs are produced, so it is never read as the initializing pull request", () => {
    let inputs: ReturnType<typeof readBaseInputs> | undefined
    expect(() => {
      inputs = readBaseInputs(failingOn(UNRESOLVED_PATH), "base")
    }).toThrow()
    expect(inputs).toBeUndefined()
  })

  test("#given a row file the listing names but the ref lacks #then it fails, not an empty row file", () => {
    expect(() => readBaseInputs((_ref, path) => (path === ROW_FILE ? undefined : PRESENT[path]), "base")).toThrow(
      "has no such file",
    )
  })
})
