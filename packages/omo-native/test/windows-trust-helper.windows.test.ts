import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { selectEngineTrust } from "../engine-trust-policy"
import {
  WINDOWS_TRUST_HELPER_EXIT,
  decodeWindowsTrustHelperOutput,
  encodeBundledRootsForHelper,
  windowsTrustHelperEnvironment,
} from "../windows-trust-helper"
import { issueCertificates } from "./trust-certificate-fixtures"

// Design 9.2, on the Windows CI job: the release helper against this machine's real Crypt32 stores, then the
// production decoder and selectEngineTrust. The engine-trust-helper workflow builds the crate and names its
// target directory here; a required run without it fails instead of skipping.
const targetDirectory = process.env.OMO_ENGINE_TRUST_HELPER_TARGET_DIR
if (process.env.OMO_ENGINE_TRUST_HELPER_REQUIRED === "1" && targetDirectory === undefined) {
  throw new Error("OMO_ENGINE_TRUST_HELPER_REQUIRED=1 but OMO_ENGINE_TRUST_HELPER_TARGET_DIR is unset")
}

async function run(stdin: Uint8Array) {
  const child = Bun.spawn([join(targetDirectory ?? "", "omo-engine-trust-helper.exe")], {
    env: windowsTrustHelperEnvironment(process.env),
    stdin: new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
    // A circuit breaker above the helper's own 20 s watchdog, never a synchronization point.
    timeout: 60_000,
  })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).bytes(), new Response(child.stderr).text(), child.exited])
  return { stdout, stderr, code }
}

describe.skipIf(process.platform !== "win32" || targetDirectory === undefined)("Windows engine trust helper", () => {
  let base = ""
  let bundled = new Uint8Array()
  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), "omo-windows-trust-helper-"))
    const issued = await issueCertificates(base, [
      { name: "B", subject: "/CN=Example Trust Test windows helper bundled root", days: 30, extensions: "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign" },
    ])
    bundled = new Uint8Array(issued.get("B") ?? [])
  })
  afterAll(async () => {
    if (base) await rm(base, { recursive: true, force: true })
  })

  test("#given Bun's bundled roots on stdin #when the helper reads this machine's stores #then its output decodes and the policy selects", async () => {
    const result = await run(encodeBundledRootsForHelper([bundled]))
    expect({ code: result.code, stderr: result.stderr }).toEqual({ code: 0, stderr: "" })
    const decoded = decodeWindowsTrustHelperOutput(result.stdout)
    if (decoded.kind !== "decoded") throw new Error(`${decoded.check} at ${decoded.path}`)
    const { facts, sources, ctl } = decoded.document
    expect(facts.bundledRoots).toEqual([{
      sha256: createHash("sha256").update(bundled).digest("hex"),
      sha1: createHash("sha1").update(bundled).digest("hex"),
    }])
    // Outcomes only: no store content is asserted.
    const unread = sources.filter((source) => source.store === "Disallowed" && source.outcome !== "read" && source.outcome !== "absent")
    expect({ complete: facts.complete, ctl, unread }).toEqual({ complete: true, ctl: expect.stringMatching(/^(read|absent)$/), unread: [] })
    const attempted = new Set(sources.filter((source) => source.store === "Disallowed").map((source) => source.location))
    for (const location of ["CURRENT_USER", "LOCAL_MACHINE", "CURRENT_USER_GROUP_POLICY", "LOCAL_MACHINE_GROUP_POLICY", "LOCAL_MACHINE_ENTERPRISE", "USER_SID"] as const) {
      expect(attempted.has(location)).toBe(true)
    }
    expect(selectEngineTrust(facts).status).toBe("selected")
  })

  test("#given stdin that is not a DER certificate list #when the helper runs #then it exits badStdin with no stdout", async () => {
    const result = await run(new Uint8Array([0x30, 0x05, 0x00]))
    expect({ code: result.code, stdout: result.stdout.length }).toEqual({ code: WINDOWS_TRUST_HELPER_EXIT.badStdin, stdout: 0 })
  })
})
