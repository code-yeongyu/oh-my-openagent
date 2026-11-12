// Owned macOS guest pool for the per-PR live tier: start one guest per major for a run, then delete it.
//
//   bun script/qa/computer/pool/macos-vm.ts --up <15|26> --run-id <id>     (on the pool host the lead placed)
//   bun script/qa/computer/pool/macos-vm.ts --down <15|26> --run-id <id>   (always, after the job)
//   bun script/qa/computer/pool/macos-vm.ts --sweep                        (deletes this pool's stopped guests; running ones are kept)
//
// The hypervisor command is POOL_HYPERVISOR (clone, run --no-graphics, list --format json, stop, delete); base images are
// POOL_BASE_IMAGE_15 / POOL_BASE_IMAGE_26. Every run ends with the teardown receipts of live-set.ts.

import { deleteGuest, type Hypervisor, sweepGuests, teardown, upStatus } from "./macos-vm-ops.ts"
import { type GuestListing, MACOS_MAJORS, type MacosMajor, planGuest, type PoolHost } from "./macos-vm-plan.ts"

type Ran = { readonly code: number; readonly stdout: string; readonly stderr: string }

const UP_DEADLINE_MS = 120_000

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

function commandHypervisor(command: string): Hypervisor {
  return {
    list: (): GuestListing[] => {
      const listed = run(command, ["list", "--format", "json"])
      if (listed.code !== 0) throw new Error(`guest list exited ${listed.code}: ${listed.stderr}`)
      const parsed: unknown = JSON.parse(listed.stdout || "[]")
      if (!Array.isArray(parsed)) throw new Error("guest list is not an array")
      return parsed.flatMap((entry) => {
        const name: unknown = typeof entry === "object" && entry !== null ? Reflect.get(entry, "Name") : undefined
        const state: unknown = typeof entry === "object" && entry !== null ? Reflect.get(entry, "State") : undefined
        return typeof name === "string" ? [{ name, running: state === "running" }] : []
      })
    },
    stop: (name) => {
      run(command, ["stop", name])
    },
    remove: (name) => {
      const removed = run(command, ["delete", name])
      return { code: removed.code, stderr: removed.stderr }
    },
  }
}

function guestProcesses(name: string): number | null {
  const found = run("/usr/bin/pgrep", ["-f", `run --no-graphics ${name}$`])
  if (found.code === 1) return 0
  if (found.code !== 0) return null
  return found.stdout.split("\n").filter((line) => line !== "").length
}

async function up(host: PoolHost, which: MacosMajor, runId: string): Promise<number> {
  const plan = planGuest(host, which, runId)
  if (plan.kind === "refused") {
    console.error(`macos-vm: refused: ${plan.reason}`)
    return 2
  }
  const command = host.hypervisor ?? ""
  const cloned = run(command, ["clone", plan.baseImage, plan.guestName])
  if (cloned.code !== 0) {
    console.error(`macos-vm: clone failed: ${cloned.stderr}`)
    return 1
  }
  const started = Bun.spawn([command, "run", "--no-graphics", plan.guestName], { stdout: "ignore", stderr: "ignore" })
  started.unref()
  const hypervisor = commandHypervisor(command)
  const deadline = Date.now() + UP_DEADLINE_MS
  let status = upStatus([], plan.guestName)
  while (status !== "running" && Date.now() < deadline) {
    await Bun.sleep(2_000)
    status = upStatus(hypervisor.list(), plan.guestName)
  }
  if (status !== "running") {
    console.error(`macos-vm: guest ${plan.guestName} is ${status} after ${UP_DEADLINE_MS / 1000} s`)
    console.log(deleteGuest(hypervisor, plan.guestName))
    return 1
  }
  console.log(`GUEST ${plan.guestName} macos=${plan.major} labels=${plan.labels.join(",")} running pid=${started.pid}`)
  return 0
}

function down(host: PoolHost, which: MacosMajor, runId: string): number {
  const plan = planGuest({ ...host, consoleUser: null }, which, runId)
  if (plan.kind === "refused") {
    console.error(`macos-vm: refused: ${plan.reason}`)
    return 2
  }
  const result = teardown(commandHypervisor(host.hypervisor ?? ""), plan.guestName, guestProcesses)
  for (const line of result.lines) console.log(line)
  return result.exitCode
}

function sweep(host: PoolHost): number {
  if (host.hypervisor === null) {
    console.error("macos-vm: refused: no hypervisor command on the pool host")
    return 2
  }
  const result = sweepGuests(commandHypervisor(host.hypervisor))
  for (const line of result.deleted) console.log(line)
  for (const name of result.kept) console.log(`guest KEPT ${name} (running: a live run may own it)`)
  console.log(`sweep: ${result.deleted.length} deleted, ${result.kept.length} kept`)
  return result.deleted.every((line) => line.startsWith("guest DELETED")) ? 0 : 1
}

async function main(args: readonly string[]): Promise<number> {
  const host = hostFacts()
  const runId = argValue(args, "--run-id") ?? ""
  if (args.includes("--up")) return up(host, major(argValue(args, "--up")), runId)
  if (args.includes("--down")) return down(host, major(argValue(args, "--down")), runId)
  if (args.includes("--sweep")) return sweep(host)
  console.error("usage: macos-vm.ts --up <15|26> --run-id <id> | --down <15|26> --run-id <id> | --sweep")
  return 2
}

process.exitCode = await main(process.argv.slice(2))
