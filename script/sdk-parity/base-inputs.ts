import { ORIGINAL_PATH, PIN_PATH, UNRESOLVED_PATH } from "./baseline"
import type { DomainFile } from "./schema"

/** A merge-base read: the file at `ref`, undefined only when the ref has no such path; any other failure throws. */
export type BaseReader = (ref: string, path: string) => string | undefined

export const ROWS_DIR_PATH = "script/sdk-parity/rows/"
export const SCENARIO_TABLE_PATH = "script/sdk-parity/scenarios.ts"
export const GOLDENS_PATH = "script/sdk-parity/goldens.json"
export const PRESENTATION_PATH = "script/sdk-parity/presentation.json"
export const OFFENDERS_PATH = "script/remote-import-guard-adapter-offenders.json"

/** Every input the gate reads from the merge base. undefined means the merge base has no such file, nothing else. */
export type BaseInputs = {
  readonly rows: readonly DomainFile[] | undefined
  readonly scenarioTable: boolean
  readonly unresolvedText: string | undefined
  readonly goldensText: string | undefined
  readonly presentationText: string | undefined
  readonly offendersText: string | undefined
  readonly originalText: string | undefined
  readonly pinText: string | undefined
}

// One place reads the merge base, with no catch: a read that fails fails the check, so no input is ever taken as
// absent (an absent unresolved list reads as the initializing pull request) because a read failed.
export function readBaseInputs(show: BaseReader, ref: string): BaseInputs {
  const listed = show(ref, ROWS_DIR_PATH)
  const rows =
    listed === undefined
      ? undefined
      : listed
          .split("\n")
          .filter((name) => name.endsWith(".json"))
          .map((name) => {
            const text = show(ref, `${ROWS_DIR_PATH}${name}`)
            if (text === undefined) throw new Error(`the merge base lists ${ROWS_DIR_PATH}${name} and has no such file`)
            return JSON.parse(text) as DomainFile
          })
  return {
    rows,
    scenarioTable: show(ref, SCENARIO_TABLE_PATH) !== undefined,
    unresolvedText: show(ref, UNRESOLVED_PATH),
    goldensText: show(ref, GOLDENS_PATH),
    presentationText: show(ref, PRESENTATION_PATH),
    offendersText: show(ref, OFFENDERS_PATH),
    originalText: show(ref, ORIGINAL_PATH),
    pinText: show(ref, PIN_PATH),
  }
}
