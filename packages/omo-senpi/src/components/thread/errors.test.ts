import { describe, expect, test } from "bun:test"

import { gatewaySchemaRefusal } from "./errors"

describe("gatewaySchemaRefusal", () => {
  const tooNew = () =>
    Object.assign(new Error("Gateway schema 17 is newer than this binary's supported version 14."), {
      code: "gateway_schema_too_new",
      details: { found: 17, supported: 14 },
    })

  test("#given a launcher brand naming another command #when the refusal is built #then it still names omo update, which every omo build answers (the engine strips SENPI_BRAND at startup and the omo thread CLI never has it)", () => {
    const prior = process.env.SENPI_BRAND
    process.env.SENPI_BRAND = JSON.stringify({ update: { command: "bun add -g omo-ai@beta" } })
    try {
      const refusal = gatewaySchemaRefusal(tooNew())
      expect(refusal).toMatchObject({
        code: "gateway_schema_too_new",
        details: { gateway_schema: 17, binary_schema: 14, update_command: "omo update" },
      })
      expect(refusal?.next_action).toContain("`omo update`")
    } finally {
      if (prior === undefined) delete process.env.SENPI_BRAND
      else process.env.SENPI_BRAND = prior
    }
  })

  test("#given any other store failure #when mapped #then it is not a schema refusal", () => {
    expect(gatewaySchemaRefusal(new Error("disk I/O error"))).toBeUndefined()
  })
})
