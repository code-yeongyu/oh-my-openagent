import { afterAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { checkAdapterImports, offenderGrowth } from "./remote-import-guard-adapter"
import { offenderBaseProblems, probeBase, repoGit } from "./sdk-parity/base-probe"
import { checkImports, type GuardFindings } from "./remote-import-guard-check"
import { createResolver } from "./remote-import-guard-resolve"
import {
  ADAPTER_OFFENDERS,
  ADAPTER_RULES,
  NON_LITERAL_IMPORT_OFFENDERS,
  REMOTE_IMPORT_RULES,
  S1_OFFENDERS,
  S2_OFFENDERS,
  S3_OFFENDERS,
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

// One scan of the repository serves G1 and family A.
const REPO_ROOT = join(import.meta.dir, "..")
const repoFacts = scanRepository(REPO_ROOT)

describe("remote import guard G1 over packages/**", () => {
  const repo = checkImports(repoFacts, createResolver(REPO_ROOT), REMOTE_IMPORT_RULES)

  test("#given S1 #then the vendored local-API client and bunshin relay transport are imported only where allowed", () => {
    // A new importer fails here; a removed one must leave S1_OFFENDERS in the same PR (the list only shrinks).
    expect(asRecord(repo.s1)).toEqual(usesOf(S1_OFFENDERS))
  })

  test("#given S2 #then connection and transport factories are used as values only where allowed", () => {
    // Matched by where the value comes from, so thread delivery's own createRelayTransport is not a hit.
    expect(asRecord(repo.s2)).toEqual(usesOf(S2_OFFENDERS))
  })

  test("#given S3 #then a remote surface reaches the remote layer only through components/remote/index.ts", () => {
    // The import boundary of #13414: thread tools, the omo remote CLI and the TUI are thin callers of the one module.
    expect(asRecord(repo.s3)).toEqual(usesOf(S3_OFFENDERS))
  })

  test("#given non-literal import() outside tests #then no file gains one", () => {
    const outsideTests = [...repo.nonLiteralImports].filter(([file]) => !REMOTE_IMPORT_RULES.testFile(file))
    expect(Object.fromEntries(outsideTests)).toEqual(NON_LITERAL_IMPORT_OFFENDERS)
  })
})

// omo#13413: the omo SDK's devices.list is the remote module's devices.list, so a script has one device-service listing.
// The account service's own listing is the SDK's account view (account.devices, the fields only the account holds) and
// nothing else: devices.list reaching it, or a remote client built past the barrel, fails here.
const sdkFactsOf = (facts: ReturnType<typeof scanRepository>) =>
  facts.filter(
    (fact) =>
      (fact.file.startsWith("packages/omo-senpi/src/components/omo-sdk/") ||
        fact.file === "packages/omo-senpi/src/extension/omo-sdk.ts") &&
      !REMOTE_IMPORT_RULES.testFile(fact.file),
  )

// Value reaches only: a type-only import of the remote module is erased at build (no runtime path; the fused bundle
// carries no remote/types.ts module), so only values count. Every value reach is pinned by exact file and target.
const sdkRemoteValueReaches = (facts: ReturnType<typeof scanRepository>, resolve: ReturnType<typeof createResolver>) =>
  sdkFactsOf(facts).flatMap((fact) =>
    fact.edges
      .filter((edge) => resolve(fact.file, edge.specifier)?.startsWith("packages/omo-senpi/src/components/remote/"))
      // A type-only edge is erased. An edge with no names is a runtime path: `export * from` or a namespace import
      // ("*"), or a bare side-effect import.
      .filter((edge) => !edge.typeOnly && (edge.names.length === 0 || edge.names.some((named) => !named.typeOnly)))
      .map((edge) => ({
        file: fact.file,
        target: resolve(fact.file, edge.specifier),
        values:
          edge.names.length === 0
            ? [edge.whole ? "*" : "(side-effect)"]
            : edge.names.filter((named) => !named.typeOnly).map((named) => named.name),
      })),
  )

const SDK_REMOTE_VALUE_REACHES = [
  // The contract's code table, data only: no device or session client.
  {
    file: "packages/omo-senpi/src/components/omo-sdk/contract/code-sources.ts",
    target: "packages/omo-senpi/src/components/remote/codes.ts",
    values: ["REMOTE_CODES"],
  },
  {
    file: "packages/omo-senpi/src/components/omo-sdk/devices/index.ts",
    target: "packages/omo-senpi/src/components/remote/index.ts",
    values: ["remoteClientForSession"],
  },
]

describe("the omo SDK's one device listing", () => {
  // One scan of the repository serves every case here (repoFacts, above), so no case re-scans the tree.
  const repoResolve = createResolver(REPO_ROOT)
  const sdkFiles = sdkFactsOf(repoFacts)

  test("#given the omo SDK's sources #then only the account view imports the account service's device listing", () => {
    const listings = sdkFiles.flatMap((fact) =>
      fact.edges
        .filter(
          (edge) =>
            edge.names.some((named) => named.name === "listLiveDevices") ||
            (edge.whole && edge.specifier.includes("service-auth")),
        )
        .map((edge) => `${fact.file} <- ${edge.specifier}`),
    )
    expect(listings).toEqual([
      "packages/omo-senpi/src/components/omo-sdk/account/index.ts <- @oh-my-opencode/omo-opencode/service-auth",
    ])
  })

  test("#given the omo SDK's sources #then devices.list reaches the remote module only through its barrel's session factory", () => {
    expect(sdkRemoteValueReaches(repoFacts, repoResolve)).toEqual(SDK_REMOTE_VALUE_REACHES)
  })

  test("#given a value import past the barrel, or the code table from a second file #then each is a reach the pinned list refuses; a type-only import is not one", () => {
    const root = mkdtempSync(join(tmpdir(), "sdk-remote-reach-"))
    try {
      const sdk = "packages/omo-senpi/src/components/omo-sdk"
      const remote = "packages/omo-senpi/src/components/remote"
      const put = (path: string, text: string): void => {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), text)
      }
      put("packages/omo-senpi/package.json", '{"name":"@oh-my-opencode/omo-senpi"}')
      put(`${remote}/index.ts`, "export const remoteClientForSession = () => 1\n")
      put(`${remote}/codes.ts`, "export const REMOTE_CODES = []\n")
      put(`${remote}/types.ts`, "export type RemoteRow = { id: string }\n")
      put(`${remote}/sessions.ts`, "export const openSessions = () => 1\n")
      put(`${sdk}/devices/index.ts`, 'import { remoteClientForSession } from "../../remote/index.ts"\n')
      put(`${sdk}/contract/code-sources.ts`, 'import { REMOTE_CODES } from "../../remote/codes.ts"\n')
      put(`${sdk}/contract/results/rows.ts`, 'import type { RemoteRow } from "../../../remote/types.ts"\n')
      const scan = (): ReturnType<typeof sdkRemoteValueReaches> => {
        execFileSync("git", ["add", "packages"], { cwd: root })
        return sdkRemoteValueReaches(scanRepository(root), createResolver(root))
      }
      execFileSync("git", ["init", "-q"], { cwd: root })
      // The allowed shape, type-only reach included, is exactly the pinned list.
      expect(scan()).toEqual(SDK_REMOTE_VALUE_REACHES)

      put(
        `${sdk}/devices/index.ts`,
        'import { remoteClientForSession } from "../../remote/index.ts"\nimport { openSessions } from "../../remote/sessions.ts"\n',
      )
      put(`${sdk}/contract/other-codes.ts`, 'import { REMOTE_CODES } from "../../remote/codes.ts"\n')
      put(`${sdk}/contract/everything.ts`, 'export * from "../../remote/sessions.ts"\n')
      put(`${sdk}/contract/warm.ts`, 'import "../../remote/sessions.ts"\n')
      put(`${sdk}/contract/later.ts`, 'export const later = () => import("../../remote/sessions.ts")\n')
      put(`${sdk}/contract/required.ts`, 'export const required = require("../../remote/sessions.ts")\n')
      put(`${sdk}/contract/whole.ts`, 'import * as remote from "../../remote/sessions.ts"\nexport const all = remote\n')
      const grown = scan()
      for (const file of ["later", "required", "whole"])
        expect(grown).toContainEqual({
          file: `${sdk}/contract/${file}.ts`,
          target: `${remote}/sessions.ts`,
          values: ["*"],
        })
      expect(grown).toContainEqual({
        file: `${sdk}/contract/everything.ts`,
        target: `${remote}/sessions.ts`,
        values: ["*"],
      })
      expect(grown).toContainEqual({
        file: `${sdk}/contract/warm.ts`,
        target: `${remote}/sessions.ts`,
        values: ["(side-effect)"],
      })
      expect(grown).not.toEqual(SDK_REMOTE_VALUE_REACHES)
      expect(grown).toContainEqual({
        file: `${sdk}/devices/index.ts`,
        target: `${remote}/sessions.ts`,
        values: ["openSessions"],
      })
      expect(grown).toContainEqual({
        file: `${sdk}/contract/other-codes.ts`,
        target: `${remote}/codes.ts`,
        values: ["REMOTE_CODES"],
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("adapter import family A (#14943 design 7.5)", () => {
  test("#given every adapter of both editions #then the layers it reaches are exactly its offender row (the list only shrinks)", () => {
    // An architecture contract: a new reach fails here, and a removed one must leave ADAPTER_OFFENDERS in the same PR.
    const found = checkAdapterImports(repoFacts, createResolver(REPO_ROOT), ADAPTER_RULES)
    expect(Object.fromEntries(found)).toEqual(usesOf(ADAPTER_OFFENDERS))
  })

  test("#given a record that drops a reach #then it passes; one that adds a file or a layer #then each is named", () => {
    const base = { "a.ts": { uses: ["L1", "L2"] }, "b.ts": { uses: ["L1"] } }
    expect(offenderGrowth(base, { "a.ts": { uses: ["L1"] } })).toEqual([])
    expect(offenderGrowth(base, { "a.ts": { uses: ["L1", "L3"] }, "c.ts": { uses: ["L1"] } })).toEqual([
      "a.ts gained L3, which the merge base's record does not list; route it through the SDK",
      "c.ts is a new adapter offender (L1); route it through the SDK instead",
    ])
  })

  test("#given an adapter that imports the delivery pipeline, directly or through a helper #then the reach is named, and the walk stops at the SDK entry", () => {
    const root = mkdtempSync(join(tmpdir(), "adapter-guard-"))
    try {
      const thread = "packages/omo-senpi/src/components/thread"
      const put = (path: string, text: string): void => {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), text)
      }
      put("packages/omo-senpi/package.json", '{"name":"@oh-my-opencode/omo-senpi"}')
      put(`${thread}/gateway/pipeline.ts`, "export const deliver = () => 1\n")
      put(`${thread}/sdk.ts`, 'import { deliver } from "./gateway/pipeline.ts"\nexport const sdk = { deliver }\n')
      put(`${thread}/helper.ts`, 'export { deliver } from "./gateway/pipeline.ts"\n')
      put(
        `${thread}/tools.ts`,
        'import { deliver } from "./helper.ts"\nimport { sdk } from "./sdk.ts"\nimport "node:net"\n',
      )
      put(`${thread}/tools/extension-tools.ts`, 'import { sdk } from "../sdk.ts"\n')
      execFileSync("git", ["init", "-q"], { cwd: root })
      execFileSync("git", ["add", "packages"], { cwd: root })
      const found = checkAdapterImports(scanRepository(root), createResolver(root), ADAPTER_RULES)
      expect(Object.fromEntries(found)).toEqual({
        [`${thread}/tools.ts`]: ["node:net", "packages/omo-senpi/src/components/thread/gateway/"],
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
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
  write(`${senpi}/src/components/remote/index.ts`, 'export { createRemoteClient } from "./client.ts"\n')
  write(`${senpi}/src/components/remote/sessions.ts`, "export const sessions = 1\n")
  write(`${senpi}/src/components/remote/port/device-service.ts`, "export const port = 1\n")
  write(`${senpi}/src/components/thread/tool-entry.ts`, 'import { createRemoteClient } from "../remote/index.ts"\n')
  write(`${senpi}/src/components/remote/lazy.ts`, 'export { createLazyRemoteSurface } from "./port/lazy-remote.ts"\n')
  write(`${senpi}/src/components/remote/port/lazy-remote.ts`, "export const createLazyRemoteSurface = 1\n")
  write(`${senpi}/src/components/thread/tool-lazy.ts`, 'import { createLazyRemoteSurface } from "../remote/lazy.ts"\n')
  write(
    `${senpi}/src/components/thread/tool-lazy-inner.ts`,
    'import { createLazyRemoteSurface } from "../remote/port/lazy-remote.ts"\n',
  )
  write(`${senpi}/src/components/thread/tool-member.ts`, 'import { sessions } from "../remote/sessions.ts"\n')
  write(`${senpi}/src/components/thread/tool-port.ts`, 'import type { port } from "../remote/port/device-service.ts"\n')
  write(
    `${senpi}/src/components/thread/tool-l1.ts`,
    'import type { DeviceService } from "@oh-my-opencode/device-service-core"\n',
  )
  write(`${senpi}/src/components/thread/tool.test.ts`, 'import { sessions } from "../remote/sessions.ts"\n')
  write(
    "packages/omo-native/remote-verb.ts",
    'import { sessions } from "../omo-senpi/src/components/remote/sessions.ts"\n',
  )
  write("packages/omo-native/other.ts", 'import { sessions } from "../omo-senpi/src/components/remote/sessions.ts"\n')
  // The SDK's declaration surface may name the module's types directly, type-only; any value, or another layer, is a reach.
  write(
    "packages/omo-native/remote-sdk-api.ts",
    'import type { sessions } from "../omo-senpi/src/components/remote/sessions.ts"\nimport type { DeviceService } from "@oh-my-opencode/device-service-core"\n',
  )
  write(
    "packages/omo-native/remote-sdk.ts",
    'import { sessions } from "../omo-senpi/src/components/remote/sessions.ts"\n',
  )
  write(
    `${senpi}/src/components/remote/tui/command.ts`,
    'import { sessions } from "../sessions.ts"\nimport { run } from "./run.ts"\n',
  )
  write(
    `${senpi}/src/components/remote/tui/run.ts`,
    'import type { DeviceService } from "@oh-my-opencode/device-service-core"\nexport const run = 1\n',
  )
  write(`${senpi}/src/components/remote/tui/entry.ts`, 'import { createRemoteClient } from "../index.ts"\n')
  execFileSync("git", ["init", "-q"], { cwd: root })
  execFileSync("git", ["add", "packages"], { cwd: root })
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
    expect(Object.fromEntries(fixture.nonLiteralImports)).toEqual({
      [`${senpi}/src/dynamic.ts`]: 1,
    })
  })

  test("#given each import shape #then S3 holds surfaces to the module's three entries (index.ts, lazy.ts, admin.ts), type-only included, tests and non-surfaces exempt", () => {
    // tool-entry (index.ts) and tool-lazy (lazy.ts) pass; tool-lazy-inner reaches the same surface past its entry.
    expect(asRecord(fixture.s3)).toEqual({
      [`${senpi}/src/components/thread/tool-l1.ts`]: ["packages/device-service-core/src/"],
      [`${senpi}/src/components/thread/tool-lazy-inner.ts`]: ["packages/omo-senpi/src/components/remote/"],
      [`${senpi}/src/components/thread/tool-member.ts`]: ["packages/omo-senpi/src/components/remote/"],
      [`${senpi}/src/components/thread/tool-port.ts`]: ["packages/omo-senpi/src/components/remote/"],
      "packages/omo-native/remote-verb.ts": ["packages/omo-senpi/src/components/remote/"],
      "packages/omo-native/remote-sdk-api.ts": ["packages/device-service-core/src/"],
      "packages/omo-native/remote-sdk.ts": ["packages/omo-senpi/src/components/remote/"],
      [`${senpi}/src/components/remote/tui/command.ts`]: ["packages/omo-senpi/src/components/remote/"],
      [`${senpi}/src/components/remote/tui/run.ts`]: ["packages/device-service-core/src/"],
    })
  })
})

// Home two of the offender-record check (home one is gate-cli.ts in the SDK Parity job); see sdk-parity/base-probe.ts.
const BASE = probeBase(repoGit)
describe("adapter offender record against the merge base (runs whenever the merge base is readable)", () => {
  test.skipIf(!BASE.readable)(
    `#given the merge base's offender record #then this head's record only shrinks against it${BASE.readable ? "" : ` [skipped: ${BASE.reason}]`}`,
    () => {
      expect(offenderBaseProblems(repoGit, ADAPTER_OFFENDERS)).toEqual({ problems: [] })
    },
  )
})
