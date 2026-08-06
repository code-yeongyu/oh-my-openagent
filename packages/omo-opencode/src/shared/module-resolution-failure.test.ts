import { describe, expect, it } from "bun:test"
import { createRequire } from "node:module"

import { isModuleResolutionFailure } from "./module-resolution-failure"

const MISSING_SPECIFIER = "definitely-not-a-real-package-omo-test"

async function captureRealImportFailure(): Promise<unknown> {
  try {
    await import(MISSING_SPECIFIER)
  } catch (error) {
    return error
  }
  throw new Error("expected the import probe to fail")
}

function captureRealRequireResolveFailure(): unknown {
  const requireFromHere = createRequire(import.meta.url)
  try {
    requireFromHere.resolve(`${MISSING_SPECIFIER}/package.json`)
  } catch (error) {
    return error
  }
  throw new Error("expected the require.resolve probe to fail")
}

describe("isModuleResolutionFailure", () => {
  it("#given a real Bun dynamic-import failure #when classifying #then it is a resolution failure even though it is not an Error instance", async () => {
    const resolveMessage = await captureRealImportFailure()

    expect(resolveMessage instanceof Error).toBe(false)
    expect(isModuleResolutionFailure(resolveMessage)).toBe(true)
  })

  it("#given a real Bun require.resolve failure #when classifying #then it is a resolution failure", () => {
    const resolveMessage = captureRealRequireResolveFailure()

    expect(isModuleResolutionFailure(resolveMessage)).toBe(true)
  })

  it("#given a Node-style MODULE_NOT_FOUND error #when classifying #then it is a resolution failure", () => {
    const nodeError = Object.assign(new Error("Cannot find module 'x'"), { code: "MODULE_NOT_FOUND" })

    expect(isModuleResolutionFailure(nodeError)).toBe(true)
  })

  it("#given an ordinary Error #when classifying #then it is not a resolution failure", () => {
    expect(isModuleResolutionFailure(new Error("boom"))).toBe(false)
  })

  it("#given non-object throw values #when classifying #then they are not resolution failures", () => {
    expect(isModuleResolutionFailure(null)).toBe(false)
    expect(isModuleResolutionFailure(undefined)).toBe(false)
    expect(isModuleResolutionFailure("ResolveMessage")).toBe(false)
    expect(isModuleResolutionFailure(42)).toBe(false)
  })
})
