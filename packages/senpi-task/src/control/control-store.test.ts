import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, linkSync, lstatSync, mkdirSync, symlinkSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { cleanupProjects, seedRecord, tempStore } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { defaultControlFsEnv, readControlFile, writeControlFile } from "./control-fs"
import { controlDir, registerName } from "./control-paths"
import type { ControlRegister } from "./control-schema"
import { deleteRegisterIfUnchanged, readRegister, writeRegister } from "./control-store"

afterEach(cleanupProjects)

const posix = process.platform !== "win32"

function register(overrides: Partial<ControlRegister> = {}): ControlRegister {
  return {
    version: 1, taskId: "st_00000001", runEpoch: 1, parentSessionId: "parent-1", pauseSeq: 2,
    runRef: { kind: "task", id: "st_00000001" }, phase: "paused",
    requester: { pid: 4242, managerInstance: "requester-a" }, writtenAt: new Date(0).toISOString(), ...overrides,
  }
}

function setup() {
  const store = tempStore()
  seedRecord(store, { task_id: "st_00000001", status: "running", run_epoch: 1, host_pid: 7 })
  return { store, control: { stateDir: store.stateDir, env: defaultControlFsEnv() } }
}

const current = (control: { stateDir: string; env: ReturnType<typeof defaultControlFsEnv> }) => {
  const read = readRegister(control, registerName("st_00000001", "parent-1"))
  return read.kind === "ok" ? read.register : undefined
}

describe("control register max-merge (design 3.1, tests 11 and 12)", () => {
  test("#given resumed@S #when a stale paused@S and paused@S-1 arrive #then the register stays resumed@S", () => {
    const { store, control } = setup()
    writeRegister(store, control, register({ phase: "resumed", resumeId: "r-2" }))
    writeRegister(store, control, register({ phase: "paused" }))
    writeRegister(store, control, register({ phase: "paused", pauseSeq: 1 }))
    expect(current(control)).toMatchObject({ phase: "resumed", pauseSeq: 2, resumeId: "r-2" })
  })

  test("#given cancelled in an epoch #when resumed@S+1 arrives #then cancelled stays sticky; a newer epoch replaces it", () => {
    const { store, control } = setup()
    writeRegister(store, control, register({ phase: "cancelled", cancel: { requestedAt: new Date(0).toISOString() } }))
    writeRegister(store, control, register({ phase: "resumed", resumeId: "r-3", pauseSeq: 3 }))
    expect(current(control)?.phase).toBe("cancelled")
    writeRegister(store, control, register({ phase: "paused", runEpoch: 2, pauseSeq: 1 }))
    expect(current(control)).toMatchObject({ phase: "paused", runEpoch: 2 })
  })

  test("#given guidance at S #when the seq moves to S+1 #then the entry is carried forward, highest revision wins", () => {
    const { store, control } = setup()
    writeRegister(store, control, register({ guidance: [{ inputId: "send-1", revision: 0, text: "first" }] }))
    writeRegister(store, control, register({ pauseSeq: 3, guidance: [{ inputId: "send-1", revision: 1, text: "edited" }] }))
    expect(current(control)).toMatchObject({ pauseSeq: 3, guidance: [{ inputId: "send-1", revision: 1, text: "edited" }] })
  })

  test("#given an owner acted on content A #when a requester wrote paused@S+1 meanwhile #then the content-compared delete keeps it", () => {
    const { store, control } = setup()
    writeRegister(store, control, register())
    const actedOn = readRegister(control, registerName("st_00000001", "parent-1"))
    if (actedOn.kind !== "ok") throw new Error("register missing")
    writeRegister(store, control, register({ pauseSeq: 3 }))
    expect(deleteRegisterIfUnchanged(store, control, actedOn.register, actedOn.text)).toBe(false)
    expect(current(control)?.pauseSeq).toBe(3)
  })

  test("#given nine guidance entries after a merge #when written #then it is refused guidance_too_large and nothing is truncated", () => {
    const { store, control } = setup()
    const eight = Array.from({ length: 8 }, (_, index) => ({ inputId: `send-${index}`, revision: 0, text: "x" }))
    writeRegister(store, control, register({ guidance: eight }))
    expect(writeRegister(store, control, register({ guidance: [{ inputId: "send-9", revision: 0, text: "y" }] })))
      .toEqual({ kind: "refused", reason: "guidance_too_large" })
    expect(current(control)?.guidance).toHaveLength(8)
  })
})

describe("win32 control files (test 22)", () => {
  test("#given the win32 flag set #when a register is written and read back #then it round-trips without uid or mode checks", () => {
    const { store } = setup()
    const win32 = { ...defaultControlFsEnv(), platform: "win32" as const }
    const control = { stateDir: store.stateDir, env: win32 }
    expect(writeRegister(store, control, register()).kind).toBe("written")
    expect(readRegister(control, registerName("st_00000001", "parent-1")).kind).toBe("ok")
  })
})

describe.if(posix)("control directory and file rules (design 3.1 / 3.3 step 1, test 15)", () => {
  test("#given control/ is a symlink #when a requester writes #then it refuses and nothing lands at the link target", () => {
    const { store, control } = setup()
    const target = join(store.stateDir, "elsewhere")
    mkdirSync(target, { mode: 0o700 })
    symlinkSync(target, controlDir(store.stateDir))
    expect(writeRegister(store, control, register())).toEqual({ kind: "refused", reason: "control_dir_unsafe" })
    expect(existsSync(join(target, registerName("st_00000001", "parent-1")))).toBe(false)
  })

  test.each([
    ["a symlinked file", (dir: string, name: string) => { writeFileSync(join(dir, "real"), "{}", { mode: 0o600 }); symlinkSync(join(dir, "real"), join(dir, name)) }],
    ["mode 0644", (dir: string, name: string) => { writeFileSync(join(dir, name), "{}"); chmodSync(join(dir, name), 0o644) }],
    ["a second hard link", (dir: string, name: string) => { writeFileSync(join(dir, name), "{}", { mode: 0o600 }); linkSync(join(dir, name), join(dir, "copy")) }],
    ["an oversized file", (dir: string, name: string) => { writeFileSync(join(dir, name), "x".repeat(16 * 1024 + 1), { mode: 0o600 }) }],
  ])("#given %s #when the owner reads it #then it is refused", (_label, plant) => {
    const { store, control } = setup()
    const dir = controlDir(store.stateDir)
    mkdirSync(dir, { mode: 0o700 })
    plant(dir, "want-x.json")
    expect(readControlFile(dir, "want-x.json", control.env).kind).toBe("refused")
  })

  test("#given a file owned by another uid #when read #then it is refused", () => {
    const { store, control } = setup()
    const dir = controlDir(store.stateDir)
    writeControlFile(dir, "want-x.json", "{}", control.env)
    const foreign = { ...control.env, lstat: (path: string) => {
      const stat = lstatSync(path)
      return path.endsWith("want-x.json") ? Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { uid: (stat.uid + 1) }) : stat
    } }
    expect(readControlFile(dir, "want-x.json", foreign)).toEqual({ kind: "refused", reason: "file_unsafe" })
    expect(readControlFile(dir, "want-x.json", control.env).kind).toBe("ok")
  })

  test("#given a group-writable control/ #when anyone reads or writes #then it is refused", () => {
    const { store, control } = setup()
    const dir = controlDir(store.stateDir)
    mkdirSync(dir, { mode: 0o700 })
    chmodSync(dir, 0o770)
    expect(writeRegister(store, control, register())).toEqual({ kind: "refused", reason: "control_dir_unsafe" })
    expect(readControlFile(dir, "want-x.json", control.env)).toEqual({ kind: "refused", reason: "control_dir_unsafe" })
  })
})
