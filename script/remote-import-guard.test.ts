import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { checkImports, type GuardFindings } from "./remote-import-guard-check"
import { createResolver } from "./remote-import-guard-resolve"
import {
  NON_LITERAL_IMPORT_OFFENDERS,
  REMOTE_IMPORT_RULES,
  S1_OFFENDERS,
  S2_OFFENDERS,
} from "./remote-import-guard-rules"
import { scanRepository } from "./remote-import-guard-scan"

// Guard G1 of the "one remote module" design (v6 sections 1 and 12): the vendored local-API client (L0) is imported only
// by device-service-core (L1), and the functions that open a local-API connection or a relay transport are called only
// from device-service-core, components/remote (L2) and three named infrastructure callers. An architecture contract.

const findings = (root: string): GuardFindings =>
  checkImports(scanRepository(root), createResolver(root), REMOTE_IMPORT_RULES)

const asRecord = (map: ReadonlyMap<string, readonly string[]>): Record<string, readonly string[]> =>
  Object.fromEntries(map)

const usesOf = (offenders: Readonly<Record<string, { readonly uses: readonly string[] }>>) =>
  Object.fromEntries(Object.entries(offenders).map(([file, offender]) => [file, offender.uses.toSorted()]))

describe("remote import guard G1 over packages/**", () => {
  const repo = findings(join(import.meta.dir, ".."))

  test("#given S1 #then the vendored local-API client and bunshin relay transport are imported only where allowed", () => {
    // A new importer fails here; a removed one must leave S1_OFFENDERS in the same PR (the list only shrinks).
    expect(asRecord(repo.s1)).toEqual(usesOf(S1_OFFENDERS))
  })

  test("#given S2 #then connection and transport factories are used as values only where allowed", () => {
    // Matched by where the value comes from, so thread delivery's own createRelayTransport is not a hit.
    expect(asRecord(repo.s2)).toEqual(usesOf(S2_OFFENDERS))
  })

  test("#given non-literal import() outside tests #then no file gains one", () => {
    const outsideTests = [...repo.nonLiteralImports].filter(([file]) => !REMOTE_IMPORT_RULES.testFile(file))
    expect(Object.fromEntries(outsideTests)).toEqual(NON_LITERAL_IMPORT_OFFENDERS)
  })
})

describe("remote import guard G1 matcher", () => {
  const root = mkdtempSync(join(tmpdir(), "remote-import-guard-"))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const dsc = "packages/device-service-core"
  const senpi = "packages/omo-senpi"
  write(`${dsc}/package.json`, '{"name":"@oh-my-opencode/device-service-core","exports":{".":"./src/index.ts"}}')
  write(`${dsc}/src/index.ts`, 'export { connectDeviceService } from "./device-service.ts"\n')
  write(
    `${dsc}/src/device-service.ts`,
    'import { connectLocalApi } from "./local-api/client.ts"\nexport const connectDeviceService = () => connectLocalApi()\n',
  )
  write(`${dsc}/src/local-api/client.ts`, "export const connectLocalApi = () => 1\n")
  write(`${senpi}/package.json`, '{"name":"@oh-my-opencode/omo-senpi","imports":{"#dsc-runtime":"./src/runtime.ts"}}')
  write(`${senpi}/vendor/bunshin-ts-relay/index.js`, "export function createRelayTransport() {}\n")
  write(`${senpi}/src/runtime.ts`, 'export { connectDeviceService } from "@oh-my-opencode/device-service-core"\n')
  write(`${senpi}/src/alias-user.ts`, 'import { connectDeviceService } from "#dsc-runtime"\nconnectDeviceService()\n')
  write(
    `${senpi}/src/lazy-user.ts`,
    'const m = await import("@oh-my-opencode/device-service-core")\nm.connectDeviceService()\n',
  )
  write(
    `${senpi}/src/require-user.cjs`,
    'const { connectDeviceService } = require("@oh-my-opencode/device-service-core")\n',
  )
  write(
    `${senpi}/src/type-user.ts`,
    'import type { connectDeviceService } from "@oh-my-opencode/device-service-core"\nimport { type connectDeviceService as c } from "../../device-service-core/src/index.ts"\n',
  )
  write(
    `${senpi}/src/deep-l0.ts`,
    'import type { connectLocalApi } from "../../device-service-core/src/local-api/client.ts"\n',
  )
  write(`${senpi}/src/own-transport.ts`, "export function createRelayTransport() {}\n")
  write(
    `${senpi}/src/delivery.ts`,
    'import { createRelayTransport } from "./own-transport.ts"\ncreateRelayTransport()\n',
  )
  write(`${senpi}/src/machine.ts`, 'import { createRelayTransport } from "../vendor/bunshin-ts-relay/index.js"\n')
  write(
    `${senpi}/src/components/remote/client.ts`,
    'import { connectDeviceService } from "@oh-my-opencode/device-service-core"\nimport { createRelayTransport } from "../../../vendor/bunshin-ts-relay/index.js"\n',
  )
  write(
    `${senpi}/src/user.test.ts`,
    'import { connectLocalApi } from "../../device-service-core/src/local-api/client.ts"\n',
  )
  write(`${senpi}/src/dynamic.ts`, "export const load = (name: string) => import(name)\n")
  const fixture = findings(root)

  test("#given each import shape #then S1 matches the vendored client even through a type-only import", () => {
    expect(asRecord(fixture.s1)).toEqual({
      [`${senpi}/src/deep-l0.ts`]: ["packages/device-service-core/src/local-api/"],
      [`${senpi}/src/machine.ts`]: ["packages/omo-senpi/vendor/bunshin-ts-relay/"],
    })
  })

  test("#given each import shape #then S2 matches value uses by source and exempts types, tests and L2", () => {
    expect(asRecord(fixture.s2)).toEqual({
      [`${senpi}/src/alias-user.ts`]: ["connectDeviceService"],
      [`${senpi}/src/lazy-user.ts`]: ["connectDeviceService"],
      [`${senpi}/src/machine.ts`]: ["createRelayTransport"],
      [`${senpi}/src/require-user.cjs`]: ["connectDeviceService"],
      [`${senpi}/src/runtime.ts`]: ["connectDeviceService"],
    })
    expect(Object.fromEntries(fixture.nonLiteralImports)).toEqual({ [`${senpi}/src/dynamic.ts`]: 1 })
  })
})
