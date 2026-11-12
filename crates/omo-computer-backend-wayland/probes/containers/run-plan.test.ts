// SP-W run plan: which mode the probe runs in, and how a container's rows are reconciled with the request.
import { describe, expect, test } from "bun:test"
import { chooseMode, reconcileRows } from "./run-plan.ts"

describe("mode", () => {
  test("--in-session selects the in-session mode anywhere", () => {
    expect(chooseMode({ inSession: true, hasDocker: true, dockerenv: false })).toBe("session")
    expect(chooseMode({ inSession: true, hasDocker: false, dockerenv: true })).toBe("session")
  })
  test("a devcontainer or Codespace with docker is the host mode, /.dockerenv notwithstanding", () =>
    expect(chooseMode({ inSession: false, hasDocker: true, dockerenv: true })).toBe("host"))
  test("a host with docker is the host mode", () =>
    expect(chooseMode({ inSession: false, hasDocker: true, dockerenv: false })).toBe("host"))
  test("the probe image (no docker, /.dockerenv) is the in-session mode, so the missing session is the reported precondition", () =>
    expect(chooseMode({ inSession: false, hasDocker: false, dockerenv: true })).toBe("session"))
  test("no docker and no container is the host mode (it fails naming docker)", () =>
    expect(chooseMode({ inSession: false, hasDocker: false, dockerenv: false })).toBe("host"))
})

describe("reconcile", () => {
  const row = (id: string) => ({ id, answer: true })
  test("every requested row returned: unchanged, in request order", () => {
    const r = reconcileRows(["a", "b"], [row("b"), row("a")], 0)
    expect(r.rows.map((x) => x.id)).toEqual(["a", "b"])
    expect(r.missing).toEqual([])
  })
  test("a row that never arrived becomes UNMEASURED with the exit code, never keeps an old value", () => {
    const r = reconcileRows(["a", "b"], [row("a")], 3)
    expect(r.missing).toEqual(["b"])
    const b = r.rows.find((x) => x.id === "b")
    expect(b?.answer).toBeNull()
    expect(b && "reason" in b ? b.reason : "").toContain("exit 3")
  })
  test("a row that was not requested is an error", () =>
    expect(() => reconcileRows(["a"], [row("a"), row("z")], 0)).toThrow("not requested: z"))
  test("a row reported twice is an error", () =>
    expect(() => reconcileRows(["a"], [row("a"), row("a")], 0)).toThrow("twice: a"))
})
