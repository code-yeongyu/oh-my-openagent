import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { ExtraCaCertificatesError, MAX_EXTRA_CA_BYTES, parseExtraCaCertificates } from "../compiled-ca-trust"

const fixtures = join(import.meta.dir, "fixtures", "ca-trust")
const fixture = (name: string) => readFileSync(join(fixtures, name), "utf8")

describe("parseExtraCaCertificates", () => {
  test("#given one CA PEM twice with CRLF #then returns it once", () => {
    const ca = fixture("ca.pem")
    expect(parseExtraCaCertificates(`${ca}\r\n${ca.replaceAll("\n", "\r\n")}`)).toHaveLength(1)
  })

  test("#given LF, CRLF, CR-CR-LF and mixed endings #then every form parses to the identical certificate set", () => {
    const ca = fixture("ca.pem")
    const lf = parseExtraCaCertificates(ca)
    const forms = [
      ca.replaceAll("\n", "\r\n"),
      ca.replaceAll("\n", "\r\r\n"),
      ca.split("\n").map((line, index) => line + (index % 2 === 0 ? "\r\n" : "\n")).join(""),
    ]
    for (const form of forms) expect(parseExtraCaCertificates(form)).toEqual(lf)
  })

  test.each([
    ["plain text", "hello"],
    ["a private key", fixture("leaf.key")],
    ["a server certificate", fixture("leaf.pem")],
    ["a CA:FALSE certificate", fixture("not-ca.pem")],
    ["text around a certificate", `junk\n${fixture("ca.pem")}`],
    ["an oversized value", "a".repeat(MAX_EXTRA_CA_BYTES + 1)],
  ])("#given %s #then fails closed", (_name, value) => {
    expect(() => parseExtraCaCertificates(value)).toThrow(ExtraCaCertificatesError)
  })
})

describe("engine entry", () => {
  const entry = join(import.meta.dir, "..", "compile-entry.ts")
  const runEntry = (args: readonly string[], home?: string) =>
    spawnSync(process.execPath, [entry, ...args], {
      env: { ...process.env, ...(home === undefined ? {} : { HOME: home }), OMO_EXTRA_CA_CERTIFICATES: "junk" },
      encoding: "utf8",
    })

  // Security contract (#10236): a bad trust value fails closed for every argv except the exact
  // `--version` and `--help`, so no engine code (extension loading, package installs) runs under it.
  test.each([
    { args: ["doctor"] },
    { args: ["-h"] },
    { args: ["-v"] },
    { args: ["--help", "x"] },
    { args: ["--version", "doctor"] },
    { args: ["--version", "--help"] },
    { args: ["setup", "--help"] },
  ].map((row) => [row.args.join(" "), row] as const))("#given an invalid OMO_EXTRA_CA_CERTIFICATES #then `%s` refuses to start", (_argv, { args }) => {
    const run = runEntry(args)
    expect({ status: run.status, named: run.stderr.includes("OMO_EXTRA_CA_CERTIFICATES") }).toEqual({ status: 78, named: true })
  }, 60_000)

  // The answer comes from static local data before anything else runs: an empty HOME stays empty,
  // where the engine's help path would run migrations and write its state there.
  test.each([
    { args: ["--version"], output: /^omo \S+ \(engine: / },
    { args: ["--help"], output: /^Usage: omo / },
  ].map((row) => [row.args.join(" "), row] as const))("#given an invalid OMO_EXTRA_CA_CERTIFICATES #then `%s` answers without starting anything", (_argv, { args, output }) => {
    const home = mkdtempSync(join(tmpdir(), "omo-trust-home-"))
    try {
      const run = runEntry(args, home)
      expect({ status: run.status, warned: run.stderr.includes("OMO_EXTRA_CA_CERTIFICATES") }).toEqual({ status: 0, warned: true })
      expect(run.stdout).toMatch(output)
      expect(readdirSync(home)).toEqual([])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  }, 60_000)
})
