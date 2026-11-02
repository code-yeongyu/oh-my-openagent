import { afterAll, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const homes: string[] = []
const packageRoot = resolve(import.meta.dir, "..")
const packageJson: { bin: { omo: string } } = await Bun.file(join(packageRoot, "package.json")).json()
const omoEntry = join(packageRoot, packageJson.bin.omo)
afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true })
})

// #10658 review (lead): on a Linux host without gdbus the keyring-check fallback notice shows once per process,
// through the real `omo account` entrypoint, however many stores the command builds.
test("omo account adopt on Linux with no gdbus succeeds and prints the fallback notice once", async () => {
  const home = mkdtempSync(join(tmpdir(), "omo-account-entry-"))
  homes.push(home)
  const credential = {
    accessToken: "at", accessTokenExpiresAt: new Date(Date.now() + 600_000).toISOString(), refreshToken: "rt",
    device: { id: "dev_e", name: "entry" }, signingPrivateKey: "c2lnbmluZw==", sealingPrivateKey: "c2VhbGluZw==",
  }
  const child = Bun.spawn([
    process.execPath, "--preload", join(import.meta.dir, "account-linux-no-gdbus.fixture.ts"),
    omoEntry, "account", "adopt",
  ], {
    cwd: home,
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, OMO_RUNTIME: "bun", OMO_SERVICE_API_URL: "http://127.0.0.1:1" },
    stdin: new Blob([JSON.stringify(credential)]), stdout: "pipe", stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect({ code, out: JSON.parse(stdout.trim()) }).toEqual({ code: 0, out: { adopted: true, device: { id: "dev_e", name: "entry" } } })
  expect(stderr.split("\n").filter((line) => line.includes("using libsecret directly"))).toHaveLength(1)
}, 20_000)
