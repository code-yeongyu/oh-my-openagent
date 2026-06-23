import { describe, expect, test } from "bun:test"
import type { Page } from "playwright-core"
import { detectChallenge } from "../detect"
import { detectMultiLayeredFirebase } from "./multi-layered-firebase"

describe("detectMultiLayeredFirebase", () => {
  test("#given Firebase auth and hCaptcha globals #when detector runs #then returns multi-layered kind", async () => {
    const result = await detectMultiLayeredFirebase(createMultiLayerPage())

    expect(result).toMatchObject({ kind: "multi_layered_firebase_recaptcha_hcaptcha", confidence: 0.85 })
  })

  test("#given page also matches plain hCaptcha #when dispatcher runs #then multi-layered detector wins ordering", async () => {
    const result = await detectChallenge(createMultiLayerPage())

    expect(result?.kind).toBe("multi_layered_firebase_recaptcha_hcaptcha")
  })
})

function createMultiLayerPage(): Page {
  return {
    $: async (selector: string) => selector.includes("hcaptcha.com") ? ({}) : null,
    evaluate: async (fn: (() => unknown) | string) => {
      const source = typeof fn === "function" ? fn.toString() : fn
      if (source.includes("firebase") && source.includes("hcaptcha")) return true
      return null
    },
  } as unknown as Page
}
