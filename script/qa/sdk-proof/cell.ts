// A step's cell from what the surface answered and what device B showed, as pure functions, so every rule has a negative
// control in sdk-proof.test.ts: a cell passes only when the surface answered as the contract says AND B shows the state.
import type { Cell } from "./evidence.ts"
import { isRecord } from "./drivers/driver.ts"

// The failure a surface answered, as its code: the thread result's error code (inside --json for the CLI), else a
// thrown error, a step that never answered, or the raw shape.
const failureOf = (raw: unknown): string => {
  const body = isRecord(raw) && isRecord(raw["json"]) ? raw["json"] : raw
  if (isRecord(body) && isRecord(body["error"]) && typeof body["error"]["code"] === "string")
    return `error ${body["error"]["code"]}`
  if (isRecord(raw) && typeof raw["exit"] === "number" && raw["exit"] !== 0)
    return `exit ${raw["exit"]}: ${
      String(raw["stderr"] ?? "")
        .trim()
        .split("\n")[0] ?? ""
    }`
  if (isRecord(raw) && "thrown" in raw) return "a thrown error"
  if (isRecord(raw) && "no_answer_within_ms" in raw) return "nothing within the step deadline"
  return "no success result"
}

// The turn a send started or joined, as the surface answered it (`delivery.turn_id`, inside `json` for the CLI): the id a
// later steer names (design 6.2 `expected_turn_id`).
export const turnOf = (raw: unknown): string | undefined => {
  const body = isRecord(raw) && isRecord(raw["json"]) ? raw["json"] : raw
  const delivery = isRecord(body) ? body["delivery"] : undefined
  const turn = isRecord(delivery) ? delivery["turn_id"] : undefined
  return typeof turn === "string" || typeof turn === "number" ? String(turn) : undefined
}

/**
 * `refusal`: the code the contract refuses this input with to this surface's principal; then only that refusal passes.
 * Otherwise the surface must answer success and B must show the expected state (`verdict` undefined).
 */
export function cellOf(
  answer: { readonly answered: boolean; readonly raw: unknown },
  verdict: string | undefined,
  refusal?: string,
): { readonly cell: Cell; readonly why: string } {
  if (refusal !== undefined) {
    const refused = !answer.answered && failureOf(answer.raw) === `error ${refusal}`
    return refused
      ? { cell: "pass", why: `refused ${refusal}, as the contract says for this surface's principal` }
      : {
          cell: "fail",
          why: `expected the contract's refusal ${refusal}, the surface answered ${answer.answered ? "success" : failureOf(answer.raw)}`,
        }
  }
  if (!answer.answered) return { cell: "fail", why: `the surface answered ${failureOf(answer.raw)}` }
  return verdict === undefined ? { cell: "pass", why: "B shows the expected state" } : { cell: "fail", why: verdict }
}
