import { describe, expect, it } from "vitest"
import {
  DESKTOP_METHODS,
  DISPLAY_METHODS,
  ELEMENT_METHODS,
  WINDOW_METHODS,
} from "../../senpi-desktop-protocol/src/index"
import { computerPreludeAssets } from "../src/index"
import {
  ACTION_HELPERS,
  CHAIN_METHODS,
  COMPOSED_HELPERS,
  javascriptHelperNames,
  pythonHelperNames,
} from "./helper-names"

/** Facade helpers that send no call chain of their own: tool actions (`run`, `close`) and composed reads. */
const NON_CHAIN_HELPERS = new Set(
  [...ACTION_HELPERS, ...COMPOSED_HELPERS].filter((name) => !CHAIN_METHODS.includes(name)),
)
/** Engine controls only the host process may reach: stop-path lifecycle, resume, and session ownership. */
const HOST_CONTROL = /resume|stop|start|heartbeat|session\.open/i

function chainMethods(names: readonly string[]): string[] {
  return [...new Set(names.filter((name) => !NON_CHAIN_HELPERS.has(name)))].sort()
}

const allowlist = [...computerPreludeAssets.methodAllowlist].sort()

describe("computer facade method allowlist", () => {
  it("equals the union of the protocol tier tables", () => {
    // Given
    const tables = [DESKTOP_METHODS, DISPLAY_METHODS, WINDOW_METHODS, ELEMENT_METHODS]

    // When
    const protocolUnion = [...new Set(tables.flatMap((table) => Object.keys(table)))].sort()

    // Then
    expect(allowlist).toEqual(protocolUnion)
  })

  it("matches the JavaScript facade's helper names", async () => {
    // When
    const names = await javascriptHelperNames()

    // Then
    expect(chainMethods(names)).toEqual(allowlist)
  })

  it("matches the Python facade's helper names", () => {
    // When
    const names = pythonHelperNames()

    // Then
    expect(chainMethods(names)).toEqual(allowlist)
  })

  it("equals the chain methods generated from the facade manifest copy", () => {
    expect(allowlist).toEqual([...CHAIN_METHODS])
  })

  it.each([
    ["JavaScript", javascriptHelperNames],
    ["Python", async () => pythonHelperNames()],
  ] as const)("exposes every composed helper in the %s facade", async (_label, helperNames) => {
    // When
    const names = await helperNames()

    // Then
    expect(COMPOSED_HELPERS.filter((name) => !names.includes(name))).toEqual([])
  })

  it("contains no host-only control a model could reach", () => {
    // When
    const hostOnly = allowlist.filter((name) => HOST_CONTROL.test(name))

    // Then
    expect(hostOnly).toEqual([])
  })
})
