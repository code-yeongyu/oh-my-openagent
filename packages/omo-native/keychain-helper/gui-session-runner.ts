// GUI-session runner for the claims design v9 labels [unverified] (section 9, "GUI-session runner"). It needs a person
// at the screen of a DEDICATED QA login session and is never run in CI or in anyone's working session: it refuses
// unless OMO_KEYCHAIN_GUI_RUNNER=dedicated-qa-session is set and the session has a GUI. Every step works on a
// throwaway keychain it creates under its own temp dir (dummy password) and deletes at the end.
//
//   OMO_KEYCHAIN_GUI_RUNNER=dedicated-qa-session bun packages/omo-native/keychain-helper/gui-session-runner.ts <report.json>
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import { buildKeychainHelper } from "./build"

const CONFIRM = "dedicated-qa-session"
const ACCOUNT = "c".repeat(64)

type Observation = { readonly step: string; readonly automatic: string; readonly observed: string }

async function capture(command: readonly string[], stdin?: string): Promise<string> {
  const child = Bun.spawn([...command], { stdin: stdin === undefined ? "ignore" : "pipe", stdout: "pipe", stderr: "pipe" })
  if (stdin !== undefined && child.stdin) {
    child.stdin.write(stdin)
    child.stdin.end()
  }
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return `exit=${code} ${stdout.trim()} ${stderr.trim()}`.trim()
}

async function main(reportPath: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("macOS only.")
  if (process.env.OMO_KEYCHAIN_GUI_RUNNER !== CONFIRM)
    throw new Error(`Refusing: set OMO_KEYCHAIN_GUI_RUNNER=${CONFIRM} in a dedicated QA login session.`)
  const session = await capture(["/usr/bin/launchctl", "managername"])
  if (!session.includes("Aqua")) throw new Error(`Refusing: not a GUI (Aqua) session (${session}).`)

  const dir = mkdtempSync(join(tmpdir(), "omo-keychain-gui-"))
  const keychain = join(dir, "gui-throwaway.keychain-db")
  const helper = join(dir, "omo-keychain-test")
  const fixture = join(dir, "keychain-fixture")
  await buildKeychainHelper({ output: helper, flavor: "test" })
  const built = await capture([
    "clang", "-Wno-deprecated-declarations", "-framework", "Security", "-framework", "CoreFoundation",
    "-o", fixture, join(import.meta.dir, "test-support", "keychain-fixture.c"),
  ])
  if (!built.startsWith("exit=0")) throw new Error(built)
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  const observations: Observation[] = []
  const fx = (...args: string[]) => capture([fixture, args[0] ?? "", keychain, ...args.slice(1)])
  const helperCall = (request: object, extra: readonly string[] = []) =>
    capture([helper, "--keychain", keychain, ...extra], `${JSON.stringify(request)}\n`)
  const step = async (name: string, instruction: string, run: () => Promise<string>) => {
    await prompt.question(`\n[${name}] ${instruction}\nPress Enter to run it.`)
    const automatic = await run()
    console.log(`automatic result: ${automatic}`)
    const observed = await prompt.question("Describe exactly what appeared on screen (dialog title, buttons, or 'nothing'): ")
    observations.push({ step: name, automatic, observed })
  }

  try {
    await fx("create")
    await fx("add", ACCOUNT, "dummy-gui")
    const partition = await helperCall({ v: 1, verb: "read", account: ACCOUNT }, ["--no-ui"])
    // Precondition (design 9): the claims below are only meaningful where items get a partition entry.
    if (partition.includes('"partition":"none"')) throw new Error(`No partition entry was created in this session; stop: ${partition}`)
    observations.push({ step: "partition-at-creation", automatic: partition, observed: "checked automatically" })
    await step("own-identity-with-partition", "The creator reads and deletes its own item. Expect no dialog.", async () =>
      `${await fx("read", ACCOUNT)} | ${await fx("delete", ACCOUNT)}`)
    await step("dialog-kind-foreign-team", "The helper approves an item another identity created. Record the dialog kind, then click Allow.", async () =>
      `${await fx("add", ACCOUNT, "dummy-gui")} | ${await helperCall({ v: 1, verb: "approve", account: ACCOUNT })}`)
    await step("always-allow-then-delete", "Approve again and click Always Allow; then the helper deletes it.", async () =>
      `${await helperCall({ v: 1, verb: "approve", account: ACCOUNT })} | ${await helperCall({ v: 1, verb: "remove", account: ACCOUNT })}`)
    await step("unlock-dialog-only", "The keychain is locked, then the helper reads an owned item. Expect only the unlock dialog; enter the dummy password.", async () =>
      `${await helperCall({ v: 1, verb: "write", account: ACCOUNT, value: "dummy-owned" }, ["--no-ui"])} | ${await fx("lock")} | ${await helperCall({ v: 1, verb: "read", account: ACCOUNT })}`)
    await step("dialog-closes-on-client-exit", "A detached helper opens an approve dialog; its client exits after 5 s. Expect the dialog to appear, then vanish.", async () => {
      await fx("add", `${"d".repeat(64)}`, "dummy-foreign")
      const child = Bun.spawn([helper, "--keychain", keychain], { stdin: "pipe", stdout: "pipe", detached: true })
      child.stdin.write(`${JSON.stringify({ v: 1, verb: "approve", account: "d".repeat(64) })}\n`)
      child.stdin.flush()
      await Bun.sleep(5_000)
      child.stdin.end()
      return `exit=${await child.exited}`
    })
    await step("untrusted-delete-interactive", "Another identity (the fixture) deletes a helper-owned item with interaction allowed. Record prompt or refusal.", async () =>
      `${await helperCall({ v: 1, verb: "write", account: "e".repeat(64), value: "dummy-owned" }, ["--no-ui"])} | ${await fx("delete-interactive", "e".repeat(64))}`)
    await step("one-time-allow-cached-per-process", "Another identity reads a helper-owned item twice in ONE process. Click Allow (not Always Allow) once; record whether a second dialog appeared.", async () =>
      `${await helperCall({ v: 1, verb: "write", account: "e".repeat(64), value: "dummy-owned" }, ["--no-ui"])} | ${await fx("read-twice-interactive", "e".repeat(64))}`)
    await step("approve-snapshot", "Approve an owned item; the reply's value and mdat must belong together (not load-bearing).", async () =>
      helperCall({ v: 1, verb: "approve", account: ACCOUNT }))
  } finally {
    prompt.close()
    if (existsSync(keychain)) await fx("destroy")
    rmSync(dir, { recursive: true, force: true })
    writeFileSync(reportPath, `${JSON.stringify({ observations, keychainRemoved: !existsSync(keychain) }, null, 2)}\n`)
  }
}

if (import.meta.main) {
  const report = process.argv[2]
  if (report === undefined) throw new Error("Usage: gui-session-runner.ts <report.json>")
  await main(report)
}
