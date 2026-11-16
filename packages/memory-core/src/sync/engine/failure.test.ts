import { expect, test } from "bun:test"

import { GitCommandError } from "../../git/errors"
import { SyncFormatError } from "../crypto/vendor/sync-format/jcs"
import { SyncCommitError } from "./adapters/git-sync-repo"
import { SyncHttpError } from "./adapters/http-transport"
import { describeSyncFailure } from "./failure"
import { logCycleFailure } from "./failure-cause"

// Every raw string an error carries (message, path, stderr, a forged name or code) holds this marker:
// none of it may reach the status, which the TUI, the RPC and the desktop all read (#13635).
const RAW = "token=secret-value /home/someone/memory/.git/index"

/** An fs error shaped the way Node and Bun throw one: a message naming the path, the errno code, the syscall and the path. */
const fsError = (code: string): Error =>
  Object.assign(new Error(`${code}: failed, open '${RAW}'`), { code, errno: -1, syscall: "open", path: RAW })

test.each([
  ["ENOSPC", "disk_full"],
  ["EDQUOT", "disk_full"],
  ["EACCES", "no_write_access"],
  ["EPERM", "no_write_access"],
  ["EROFS", "no_write_access"],
] as const)("an fs %s error is a %s failure carrying its errno code and the stage that threw", (code, kind) => {
  expect(describeSyncFailure(fsError(code), "apply")).toEqual({
    kind,
    reason: expect.any(String),
    action: expect.any(String),
    cause: { errorClass: "Error", code, stage: "apply" },
  })
})

test("an fs error wrapped in another error is still named by the errno code underneath", () => {
  const wrapped = new Error("commit failed", { cause: fsError("ENOSPC") })

  expect(describeSyncFailure(wrapped, "apply")).toMatchObject({
    kind: "disk_full",
    cause: { errorClass: "Error", code: "ENOSPC", stage: "apply" },
  })
})

test("a non-transient service refusal names the service code and HTTP status", () => {
  const failure = describeSyncFailure(new SyncHttpError("payload_too_large", 413, false), "push")

  expect(failure).toEqual({
    kind: "service_refused",
    reason: expect.any(String),
    action: expect.any(String),
    cause: { errorClass: "SyncHttpError", code: "payload_too_large", httpStatus: 413, stage: "push" },
  })
})

test.each([
  ["a plain Error", new Error(RAW), { errorClass: "Error" }],
  ["a TypeError", new TypeError(RAW), { errorClass: "TypeError" }],
  [
    "an Error renamed after a built-in class",
    Object.assign(new Error(RAW), { name: "RangeError" }),
    { errorClass: "Error" },
  ],
  [
    "a failed git command",
    new GitCommandError(["commit", "-m", RAW], 128, "", `fatal: ${RAW}`),
    { errorClass: "GitCommandError", exitCode: 128 },
  ],
  [
    "a sync-format refusal",
    new SyncFormatError("bad_integer", RAW),
    { errorClass: "SyncFormatError", code: "bad_integer" },
  ],
  ["a thrown non-Error value", RAW, { errorClass: "NonError" }],
] as const)("%s stays unknown and still carries its safe cause fields", (_name, error, cause) => {
  expect(describeSyncFailure(error, "receive")).toEqual({
    kind: "unknown",
    reason: expect.any(String),
    action: expect.any(String),
    cause: { ...cause, stage: "receive" },
  })
})

test.each([
  ["a message, path and stderr", new GitCommandError([RAW], 1, RAW, RAW)],
  ["a forged error name", Object.assign(new Error(RAW), { name: RAW })],
  ["a code that is not an errno code", Object.assign(new Error(RAW), { code: RAW })],
  ["a service code that is not a code", new SyncHttpError(RAW, 400, false)],
  ["a format reason that is not a code", new SyncFormatError(RAW, RAW)],
  ["an fs error", fsError("EACCES")],
])("raw error text never crosses into the failure: %s", (_name, error) => {
  const failure = describeSyncFailure(error, "push")

  expect(JSON.stringify(failure)).not.toContain("secret-value")
  expect(JSON.stringify(failure)).not.toContain("/home/")
})

test("a failed git command on the warning names its class, subcommand and exit code only; the whole error stays at info", () => {
  const lines: { readonly line: string; readonly level: string }[] = []
  const error = new Error("commit failed", {
    cause: new GitCommandError(["--literal-pathspecs", "commit", "-m", RAW], 128, RAW, `fatal: ${RAW}`),
  })

  logCycleFailure((line, level = "info") => lines.push({ line, level }), "apply", error, true)

  const warnings = lines.filter(({ level }) => level === "warn").map(({ line }) => line)
  expect(warnings).toEqual([expect.stringContaining("GitCommandError: git commit exited 128")])
  expect(warnings[0]).not.toContain("secret-value")
  expect(lines.filter(({ level }) => level === "info").map(({ line }) => line)).toEqual([
    expect.stringContaining("secret-value"),
  ])
})

test("a failed sync-repo commit on the warning names its class only; its git output stays at info", () => {
  const lines: { readonly line: string; readonly level: string }[] = []
  const error = new Error("cycle failed", { cause: new SyncCommitError(`git commit failed: fatal: ${RAW}`) })

  logCycleFailure((line, level = "info") => lines.push({ line, level }), "apply", error, true)

  const warnings = lines.filter(({ level }) => level === "warn").map(({ line }) => line)
  expect(warnings).toEqual([expect.stringContaining("SyncCommitError")])
  expect(warnings[0]).not.toContain("secret-value")
  expect(lines.filter(({ level }) => level === "info").map(({ line }) => line)).toEqual([
    expect.stringContaining("secret-value"),
  ])
})
