// Owned macOS guest pool for the per-PR live tier: start one guest per major for a run, then delete it.
//
//   bun script/qa/computer/pool/macos-vm.ts --up <15|26> --run-id <id>     (on the pool host the lead placed)
//   bun script/qa/computer/pool/macos-vm.ts --down <15|26> --run-id <id>   (always, after the job)
//   bun script/qa/computer/pool/macos-vm.ts --sweep                        (deletes this pool's stray guests)
//
// The hypervisor command is POOL_HYPERVISOR (clone, run --no-graphics, list --format json, stop, delete); base images are
// POOL_BASE_IMAGE_15 / POOL_BASE_IMAGE_26. Every run ends with the teardown receipts of live-set.ts.

import {
  MACOS_MAJORS,
  type MacosMajor,
  planGuest,
  type PoolHost,
  strayGuests,
  type GuestListing,
} from "./macos-vm-plan.ts"
import { teardownLines } from "./live-set.ts"

type Ran = { readonly code: number; readonly stdout: string; readonly stderr: string }

function run(command: string, args: readonly string[]): Ran {
  const result = Bun.spawnSync([command, ...args], { stdout: "pipe", stderr: "pipe", timeout: 600_000 })
  return {
    code: result.exitCode ?? -1,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  }
}

function argValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  return index >= 0 ? args[index + 1] : undefined
}

function major(value: string | undefined): MacosMajor {
  const found = MACOS_MAJORS.find((candidate) => candidate === value)
  if (found === undefined) throw new Error(`macOS major must be one of ${MACOS_MAJORS.join(", ")}`)
  return found
}

function hostFacts(): PoolHost {
  const console = run("/usr/bin/stat", ["-f", "%Su", "/dev/console"])
  return {
    platform: process.platform,
    arch: process.arch,
    hypervisor: process.env.POOL_HYPERVISOR ?? null,
    baseImages: Object.fromEntries(
      MACOS_MAJORS.flatMap((m) => {
        const image = process.env[`POOL_BASE_IMAGE_${m}`]
        return image === undefined ? [] : [[m, image]]
      }),
    ),
    consoleUser: console.code === 0 && console.stdout !== "root" ? console.stdout : null,
    runnerUser: run("/usr/bin/id", ["-un"]).stdout,
  }
}

function listing(hypervisor: string): GuestListing[] {
  const listed = run(hypervisor, ["list", "--format", "json"])
  if (listed.code !== 0) throw new Error(`guest list failed: ${listed.stderr}`)
  const parsed: unknown = JSON.parse(listed.stdout || "[]")
  if (!Array.isArray(parsed)) throw new Error("guest list is not an array")
  return parsed.flatMap((entry) => {
    const name: unknown = typeof entry === "object" && entry !== null ? Reflect.get(entry, "Name") : undefined
    const state: unknown = typeof entry === "object" && entry !== null ? Reflect.get(entry, "State") : undefined
    return typeof name === "string" ? [{ name, running: state === "running" }] : []
  })
}

function deleteGuest(hypervisor: string, name: string): string {
  run(hypervisor, ["stop", name])
  const removed = run(hypervisor, ["delete", name])
  const gone = !listing(hypervisor).some((guest) => guest.name === name)
  return gone ? `guest DELETED ${name}` : `guest NOT DELETED ${name} (${removed.stderr || `exit ${removed.code}`})`
}

function up(host: PoolHost, which: MacosMajor, runId: string): number {
  const plan = planGuest(host, which, runId)
  if (plan.kind === "refused") {
    console.error(`macos-vm: refused: ${plan.reason}`)
    return 2
  }
  const hypervisor = host.hypervisor ?? ""
  const cloned = run(hypervisor, ["clone", plan.baseImage, plan.guestName])
  if (cloned.code !== 0) {
    console.error(`macos-vm: clone failed: ${cloned.stderr}`)
    return 1
  }
  const started = Bun.spawn([hypervisor, "run", "--no-graphics", plan.guestName], {
    stdout: "ignore",
    stderr: "ignore",
  })
  started.unref()
  console.log(`GUEST ${plan.guestName} macos=${plan.major} labels=${plan.labels.join(",")} pid=${started.pid}`)
  return 0
}

function down(host: PoolHost, which: MacosMajor, runId: string): number {
  const plan = planGuest(host, which, runId)
  if (plan.kind === "refused") {
    console.error(`macos-vm: refused: ${plan.reason}`)
    return 2
  }
  const receipt = deleteGuest(host.hypervisor ?? "", plan.guestName)
  for (const line of teardownLines({ procs: 0, removedDir: "-", extra: [receipt] })) console.log(line)
  return receipt.startsWith("guest DELETED") ? 0 : 1
}

function sweep(host: PoolHost): number {
  if (host.hypervisor === null) {
    console.error("macos-vm: refused: no hypervisor command on the pool host")
    return 2
  }
  const hypervisor = host.hypervisor
  const receipts = strayGuests(listing(hypervisor), new Set()).map((name) => deleteGuest(hypervisor, name))
  for (const line of receipts) console.log(line)
  console.log(`sweep: ${receipts.length} stray guest(s)`)
  return receipts.every((line) => line.startsWith("guest DELETED")) ? 0 : 1
}

function main(args: readonly string[]): number {
  const host = hostFacts()
  const runId = argValue(args, "--run-id") ?? ""
  if (args.includes("--up")) return up(host, major(argValue(args, "--up")), runId)
  if (args.includes("--down")) return down(host, major(argValue(args, "--down")), runId)
  if (args.includes("--sweep")) return sweep(host)
  console.error("usage: macos-vm.ts --up <15|26> --run-id <id> | --down <15|26> --run-id <id> | --sweep")
  return 2
}

process.exitCode = main(process.argv.slice(2))
