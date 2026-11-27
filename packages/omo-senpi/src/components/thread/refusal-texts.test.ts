import { describe, expect, test } from "bun:test"

import { ADDRESS_TEXTS } from "./address/refusal-texts"
import { CONTROL_TEXTS } from "./control/refusal-texts"
import { REFUSAL_TEXTS } from "./refusal-texts"
import { RELAY_TEXTS } from "./remote/refusal-texts"

describe("the refusal-texts registry", () => {
  test("#given the three owners' tables #when composed #then no id is defined twice (a spread would drop one silently)", () => {
    const tables: readonly object[] = [CONTROL_TEXTS, ADDRESS_TEXTS, RELAY_TEXTS]
    let total = 0
    for (const table of tables) total += Object.keys(table).length
    expect(Object.keys(REFUSAL_TEXTS)).toHaveLength(total)
  })
})
