import { describe, expect, test } from "bun:test"
import { join } from "node:path"

// The account call bodies load on the first account call that runs (P1b cold-import decision, #14950): a call the root
// boundary refuses writes its one record and never loads them; a call that runs does. Each case is its own process, so
// no other test has loaded the module first; a runtime loader hook records whether the bodies module was read.

const ASSEMBLY = join(import.meta.dir, "..", "assembly.ts")

function probe(principal: string, key: string): string {
  return `
let loaded = false
Bun.plugin({ name: "watch", setup(build) { build.onLoad({ filter: /root[\\\\/]account-members\\.ts$/ }, (args) => { loaded = true; return undefined }) } })
const { assembleOmoSdk } = await import(${JSON.stringify(ASSEMBLY)})
const records = []
const custody = {
  begin: async () => ({ recorded: true, end: async () => true }),
  refused: async (capability, code) => { records.push(capability + " " + code); return true },
}
const sdk = assembleOmoSdk({ principal: ${principal}, env: { OMO_SERVICE_API_URL: "https://accounts.example.test" }, cwd: process.cwd(), ports: { desktopLaunch: () => false, custody } }, {})
const call = ${JSON.stringify(key)}.split(".").reduce((node, part) => node[part], sdk)
const answer = await call({}).catch((error) => ({ thrown: String(error) }))
console.log(JSON.stringify({ loaded, records, code: answer?.error?.code ?? answer?.kind }))
`
}

async function run(principal: string, key: string) {
  const child = Bun.spawn([process.execPath, "-e", probe(principal, key)], {
    cwd: import.meta.dir,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (code !== 0) throw new Error(err)
  return JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as unknown
}

describe("the account call bodies load lazily", () => {
  test("#given a connector root #when account.signOut is refused at the boundary #then the refusal is recorded and the bodies never load", async () => {
    expect(await run(`{ kind: "connector", binding: "b-1" }`, "account.signOut")).toMatchObject({
      loaded: false,
      records: [expect.stringMatching(/^account\.signOut /)],
    })
  })

  test("#given a person root #when account.signInCheck runs #then the bodies load", async () => {
    expect(await run(`{ kind: "person", uid: 501 }`, "account.signInCheck")).toMatchObject({ loaded: true })
  })
})
