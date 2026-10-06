import { describe, expect, test } from "bun:test"
import { OpenClawConfigSchema } from "../../config/schema/openclaw"

describe("OpenClaw Config", () => {
  test("gateway timeout remains optional so env fallback can apply", () => {
    const parsed = OpenClawConfigSchema.parse({
      enabled: true,
      gateways: {
        command: {
          type: "command",
          command: "echo hi",
        },
      },
      hooks: {},
    })

    expect(parsed.gateways.command.timeout).toBeUndefined()
  })
})
