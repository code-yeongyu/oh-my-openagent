import { describe, expect, test } from "bun:test"

import { gatewaySchemaRefusal } from "./errors"

describe("gatewaySchemaRefusal", () => {
  const tooNew = () =>
    Object.assign(new Error("Gateway schema 17 is newer than this binary's supported version 14."), {
      code: "gateway_schema_too_new",
      details: { found: 17, supported: 14 },
    })

  test.each([
    ["no launcher brand", undefined, "omo update"],
    [
      "a launcher brand naming its update command",
      JSON.stringify({ update: { command: "bun add -g omo-ai@beta" } }),
      "bun add -g omo-ai@beta",
    ],
    ["an unreadable launcher brand", "{", "omo update"],
  ])(
    "#given %s #when the refusal is built #then it names both schemas and the command that updates this omo",
    (_case, brand, command) => {
      const refusal = gatewaySchemaRefusal(tooNew(), brand === undefined ? {} : { SENPI_BRAND: brand })
      expect(refusal).toMatchObject({
        code: "gateway_schema_too_new",
        details: { gateway_schema: 17, binary_schema: 14, update_command: command },
      })
      expect(refusal?.next_action).toContain(command)
    },
  )

  test("#given any other store failure #when mapped #then it is not a schema refusal", () => {
    expect(gatewaySchemaRefusal(new Error("disk I/O error"), {})).toBeUndefined()
  })
})
