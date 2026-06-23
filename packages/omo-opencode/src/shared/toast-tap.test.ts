import { afterEach, describe, expect, it } from "bun:test"
import {
  installToastTap,
  isToastTapInstalled,
  uninstallToastTap,
} from "./toast-tap"

function makeClient() {
  const observed: Array<{ wrapped: boolean }> = []
  const client = {
    tui: {
      showToast: async (args: unknown) => {
        observed.push({ wrapped: false })
        return args
      },
    },
  }
  return { client, observed }
}

describe("toast-tap install/uninstall", () => {
  afterEach(() => {
    const { client } = makeClient()
    uninstallToastTap(client)
  })

  describe("#given installToastTap then uninstallToastTap", () => {
    it("#when client.tui.showToast is called after uninstall, #then the ORIGINAL function runs", async () => {
      const { client, observed } = makeClient()
      const original = client.tui.showToast
      installToastTap(client)
      expect(client.tui.showToast).not.toBe(original)
      expect(isToastTapInstalled()).toBe(true)
      uninstallToastTap(client)
      expect(client.tui.showToast).toBe(original)
      expect(isToastTapInstalled()).toBe(false)
      await client.tui.showToast({ body: { title: "after-uninstall" } })
      expect(observed.length).toBe(1)
    })
  })

  describe("#given installToastTap is called twice in a row", () => {
    it("#when the second install runs, #then no nested wrapping occurs (idempotent)", () => {
      const { client } = makeClient()
      installToastTap(client)
      const wrappedFirst = client.tui.showToast
      installToastTap(client)
      expect(client.tui.showToast).toBe(wrappedFirst)
      uninstallToastTap(client)
    })
  })
})
