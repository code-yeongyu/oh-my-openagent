import { expect, test } from "bun:test"
import * as commands from "./commands"
import { deviceListSchema } from "./protocol"

test("device chooser builds inert labels from hostile server device names", () => {
  const { devices } = deviceListSchema.parse({ devices: [{
    id: "device-1", name: "\u001b[31mWork\u001b[0m\u0085\u200b laptop", revokedAt: null,
  }] })
  expect(commands.deviceChoices(devices)).toEqual([{ value: "device-1", label: "Work laptop" }])
})
