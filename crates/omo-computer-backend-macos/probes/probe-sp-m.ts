#!/usr/bin/env bun
// SP-M probe: macOS private symbols on macOS 15 and 26 (computer-use v3 plan row 6).
//
// The probe resolves every private symbol by dlsym and exercises it where the host allows, then writes one
// ledger row per question per macOS major version to macos-spi.tsv. A spike ships no engine code: this script
// and the ledger are its only outputs. See README.md beside this file for the columns and the verdict grammar.
//
//   bun probe-sp-m.ts --measure --out macos-spi.tsv [--pending 15="awaiting H2"]
//   bun probe-sp-m.ts --verify macos-spi.tsv
//   bun probe-sp-m.ts --row <id>
//   bun probe-sp-m.ts --session
//
// Every mode first checks its precondition: a macOS 15 or 26 host and a process inside that host's graphical
// (Aqua) session. Without it the probe prints one line naming what is missing, exits 3 and writes nothing.

import { CFunction, dlopen, FFIType, type Pointer, read, toArrayBuffer } from "bun:ffi"
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"

const SUPPORTED_MAJORS = [15, 26] as const
const PROBE_PATH = "crates/omo-computer-backend-macos/probes/probe-sp-m.ts"
const COLUMNS = [
  "id",
  "macos",
  "subject",
  "condition",
  "verdict",
  "rerun",
  "resolves",
  "behaves",
  "measured",
  "host_build",
  "reason",
] as const

type Verdict = "CONFIRMS" | "CONTRADICTS" | "NEW-EDGE" | "UNMEASURED"

interface Outcome {
  verdict: Verdict
  resolves: string
  behaves: string
  measured: string
  reason: string
}

interface LedgerRow extends Outcome {
  id: string
  macos: string
  subject: string
  condition: string
  rerun: string
  host_build: string
}

interface Question {
  id: string
  subject: string
  condition: string
  run: (host: Host) => Outcome
}

interface Host {
  major: number
  build: string
  session: SessionFacts
}

interface SessionFacts {
  manager: string
  user: string
  consoleUser: string
  onConsole: string
  screenLocked: string
  accessibility: boolean
  screenRecording: boolean
  postEvent: boolean
}

// ---------------------------------------------------------------------------------------------------------------
// Command line

function fail(line: string): never {
  console.error(`SP-M precondition missing: ${line}`)
  process.exit(3)
}

function sh(cmd: string[]): string {
  const res = Bun.spawnSync({ cmd, stdout: "pipe", stderr: "pipe" })
  return res.stdout.toString().trim()
}

function precondition(): { major: number; build: string } {
  if (process.platform !== "darwin") {
    fail(`a macOS 15 or 26 graphical session; this host is ${process.platform}, so no row was measured or written`)
  }
  const version = sh(["sw_vers", "-productVersion"])
  const major = Number.parseInt(version.split(".")[0] ?? "", 10)
  if (!SUPPORTED_MAJORS.includes(major as 15 | 26)) {
    fail(`a macOS 15 or 26 host; this host runs macOS ${version}`)
  }
  const manager = sh(["launchctl", "managername"])
  if (manager !== "Aqua") {
    fail(`a process inside the graphical (Aqua) session; this process runs in the '${manager}' session`)
  }
  return { major, build: `${version} ${sh(["sw_vers", "-buildVersion"])}` }
}

// ---------------------------------------------------------------------------------------------------------------
// Native access (bun:ffi). Everything private is looked up with dlsym, so a missing symbol is a value, not a crash.

const PATHS = {
  system: "/usr/lib/libSystem.B.dylib",
  objc: "/usr/lib/libobjc.A.dylib",
  cf: "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation",
  cg: "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics",
  ax: "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices",
  skylight: "/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight",
  login: "/System/Library/PrivateFrameworks/login.framework/login",
} as const

const { ptr: P, i32, u32, i64, u64, bool, void: VOID, cstring } = FFIType

function cstr(s: string): Buffer {
  return Buffer.from(`${s}\0`, "utf8")
}

let nativeCache: ReturnType<typeof openNative> | undefined
function native() {
  nativeCache ??= openNative()
  return nativeCache
}

function openNative() {
  const sys = dlopen(PATHS.system, {
    dlopen: { args: [cstring, i32], returns: P },
    dlsym: { args: [P, cstring], returns: P },
    mach_vm_read_overwrite: { args: [u32, u64, u64, P, P], returns: i32 },
    mach_absolute_time: { args: [], returns: u64 },
    getpid: { args: [], returns: i32 },
  })
  const handles = new Map<string, Pointer | null>()
  const handle = (path: string): Pointer | null => {
    if (!handles.has(path)) handles.set(path, sys.symbols.dlopen(cstr(path), 1) as Pointer | null)
    return handles.get(path) ?? null
  }
  const sym = (path: string, name: string): Pointer | null => {
    const h = handle(path)
    return h ? (sys.symbols.dlsym(h, cstr(name)) as Pointer | null) : null
  }
  const taskSelfPtr = sym(PATHS.system, "mach_task_self_")
  const taskSelf = taskSelfPtr ? read.u32(taskSelfPtr, 0) : 0
  const cf = dlopen(PATHS.cf, {
    CFArrayGetCount: { args: [P], returns: i64 },
    CFArrayGetValueAtIndex: { args: [P, i64], returns: P },
    CFArrayCreate: { args: [P, P, i64, P], returns: P },
    CFNumberCreate: { args: [P, i64, P], returns: P },
    CFNumberGetValue: { args: [P, i64, P], returns: bool },
    CFDictionaryGetValue: { args: [P, P], returns: P },
    CFStringCreateWithCString: { args: [P, cstring, u32], returns: P },
    CFStringGetCString: { args: [P, P, i64, u32], returns: bool },
    CFGetTypeID: { args: [P], returns: u64 },
    CFStringGetTypeID: { args: [], returns: u64 },
    CFNumberGetTypeID: { args: [], returns: u64 },
    CFBooleanGetTypeID: { args: [], returns: u64 },
    CFBooleanGetValue: { args: [P], returns: bool },
    CFDataGetLength: { args: [P], returns: i64 },
    CFDataGetBytePtr: { args: [P], returns: P },
    CFEqual: { args: [P, P], returns: bool },
    CFRelease: { args: [P], returns: VOID },
  })
  const cg = dlopen(PATHS.cg, {
    CGWindowListCopyWindowInfo: { args: [u32, u32], returns: P },
    CGPreflightScreenCaptureAccess: { args: [], returns: bool },
    CGPreflightPostEventAccess: { args: [], returns: bool },
    CGSessionCopyCurrentDictionary: { args: [], returns: P },
    CGEventSourceCreate: { args: [i32], returns: P },
    CGEventCreateKeyboardEvent: { args: [P, u32, bool], returns: P },
    CGEventSetIntegerValueField: { args: [P, u32, i64], returns: VOID },
    CGEventGetIntegerValueField: { args: [P, u32], returns: i64 },
    CGImageGetWidth: { args: [P], returns: u64 },
    CGImageGetHeight: { args: [P], returns: u64 },
    CGImageGetDataProvider: { args: [P], returns: P },
    CGDataProviderCopyData: { args: [P], returns: P },
  })
  const ax = dlopen(PATHS.ax, {
    AXIsProcessTrusted: { args: [], returns: bool },
    AXUIElementCreateApplication: { args: [i32], returns: P },
  })
  const objc = dlopen(PATHS.objc, {
    objc_getClass: { args: [cstring], returns: P },
    sel_registerName: { args: [cstring], returns: P },
    class_getClassMethod: { args: [P, P], returns: P },
  })
  return { sys, sym, taskSelf, cf: cf.symbols, cg: cg.symbols, ax: ax.symbols, objc: objc.symbols }
}

const kCFStringEncodingUTF8 = 0x08000100
const kCFNumberSInt32Type = 3
const kCFNumberSInt64Type = 4
const kCFNumberDoubleType = 13

function cfString(s: string): Pointer | null {
  return native().cf.CFStringCreateWithCString(null, cstr(s), kCFStringEncodingUTF8) as Pointer | null
}

function fromCfString(ref: Pointer | null): string {
  if (!ref) return ""
  const buf = new Uint8Array(1024)
  return native().cf.CFStringGetCString(ref, buf, buf.length, kCFStringEncodingUTF8)
    ? new TextDecoder().decode(buf.subarray(0, buf.indexOf(0)))
    : ""
}

function fromCfNumber(ref: Pointer | null): number | undefined {
  if (!ref) return undefined
  const n = native()
  if (n.cf.CFGetTypeID(ref) !== n.cf.CFNumberGetTypeID()) return undefined
  const out = new Float64Array(1)
  return n.cf.CFNumberGetValue(ref, kCFNumberDoubleType, out) ? out[0] : undefined
}

function dictGet(dict: Pointer, key: string): Pointer | null {
  const k = cfString(key)
  const v = native().cf.CFDictionaryGetValue(dict, k) as Pointer | null
  if (k) native().cf.CFRelease(k)
  return v
}

function cfArray(values: Pointer[]): Pointer | null {
  const n = native()
  const callbacks = n.sym(PATHS.cf, "kCFTypeArrayCallBacks")
  const items = new BigUint64Array(values.map((v) => BigInt(Number(v))))
  return n.cf.CFArrayCreate(null, items, values.length, callbacks) as Pointer | null
}

function cfNumber32(value: number): Pointer | null {
  return native().cf.CFNumberCreate(null, kCFNumberSInt32Type, new Int32Array([value])) as Pointer | null
}

function arrayItems(arr: Pointer | null): Pointer[] {
  if (!arr) return []
  const n = native()
  const count = Number(n.cf.CFArrayGetCount(arr))
  return Array.from({ length: count }, (_, i) => n.cf.CFArrayGetValueAtIndex(arr, i)).filter(
    (v): v is Pointer => v !== null,
  )
}

// Reads `size` bytes of this process's memory through mach_vm_read_overwrite, so an unreadable pointer is a
// failed read rather than a crash.
function safeRead(address: number, size: number): Uint8Array | null {
  const n = native()
  const out = new Uint8Array(size)
  const outSize = new BigUint64Array(1)
  const kr = n.sys.symbols.mach_vm_read_overwrite(n.taskSelf, BigInt(address), BigInt(size), out, outSize)
  return kr === 0 && Number(outSize[0]) === size ? out : null
}

function fn(address: Pointer | null, args: FFIType[], returns: FFIType) {
  return address ? CFunction({ ptr: address, args, returns }) : null
}

// ---------------------------------------------------------------------------------------------------------------
// Host facts

function sessionFacts(): SessionFacts {
  const n = native()
  const dict = n.cg.CGSessionCopyCurrentDictionary() as Pointer | null
  const boolKey = (key: string): string => {
    if (!dict) return "unreadable"
    const v = dictGet(dict, key)
    if (!v) return "absent"
    return n.cf.CFGetTypeID(v) === n.cf.CFBooleanGetTypeID()
      ? String(n.cf.CFBooleanGetValue(v))
      : String(fromCfNumber(v) === 1)
  }
  const facts: SessionFacts = {
    manager: sh(["launchctl", "managername"]),
    user: sh(["id", "-un"]),
    consoleUser: sh(["stat", "-f", "%Su", "/dev/console"]),
    onConsole: boolKey("kCGSessionOnConsoleKey"),
    screenLocked: boolKey("CGSSessionScreenIsLocked"),
    accessibility: Boolean(n.ax.AXIsProcessTrusted()),
    screenRecording: Boolean(n.cg.CGPreflightScreenCaptureAccess()),
    postEvent: Boolean(n.cg.CGPreflightPostEventAccess()),
  }
  if (dict) n.cf.CFRelease(dict)
  return facts
}

interface WindowInfo {
  id: number
  pid: number
  owner: string
  layer: number
  bounds: { x: number; y: number; w: number; h: number }
}

const kCGWindowListOptionOnScreenOnly = 1
const kCGWindowListExcludeDesktopElements = 16
const kCGWindowListOptionAll = 0

function windowList(option: number): WindowInfo[] {
  const n = native()
  const arr = n.cg.CGWindowListCopyWindowInfo(option, 0) as Pointer | null
  const out = arrayItems(arr).map((d) => {
    const b = dictGet(d, "kCGWindowBounds")
    return {
      id: fromCfNumber(dictGet(d, "kCGWindowNumber")) ?? 0,
      pid: fromCfNumber(dictGet(d, "kCGWindowOwnerPID")) ?? 0,
      owner: fromCfString(dictGet(d, "kCGWindowOwnerName")),
      layer: fromCfNumber(dictGet(d, "kCGWindowLayer")) ?? 0,
      bounds: {
        x: (b && fromCfNumber(dictGet(b, "X"))) || 0,
        y: (b && fromCfNumber(dictGet(b, "Y"))) || 0,
        w: (b && fromCfNumber(dictGet(b, "Width"))) || 0,
        h: (b && fromCfNumber(dictGet(b, "Height"))) || 0,
      },
    }
  })
  if (arr) n.cf.CFRelease(arr)
  return out
}

// A layer-0 on-screen window of another process: the "foreign window" the questions exercise.
function foreignWindow(): WindowInfo | undefined {
  const self = process.pid
  const candidates = windowList(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements).filter(
    (w) => w.layer === 0 && w.pid !== self && w.bounds.w >= 64 && w.bounds.h >= 64,
  )
  return candidates.find((w) => w.owner === "Finder") ?? candidates[0]
}

function bucket8(n: number): number {
  return Math.round(n / 8) * 8
}

// ---------------------------------------------------------------------------------------------------------------
// Outcome helpers

const unmeasured = (reason: string, resolves = "-", measured = "-"): Outcome => ({
  verdict: "UNMEASURED",
  resolves,
  behaves: "-",
  measured,
  reason,
})
const yesNo = (v: unknown): string => (v ? "yes" : "no")

function resolveAll(path: string, names: string[]): { all: boolean; detail: string } {
  const n = native()
  const found = names.map((name) => [name, n.sym(path, name)] as const)
  return {
    all: found.every(([, a]) => a !== null),
    detail: found.map(([name, a]) => `${name}=${a ? "yes" : "no"}`).join(","),
  }
}

function grantReason(missing: string[]): string {
  return `${missing.join(" + ")} not granted to this probe's responsible process (H3 is granted by row 9)`
}

// ---------------------------------------------------------------------------------------------------------------
// Questions. One entry per question per condition; the same list is measured on every macOS major.

function qHwCapture(host: Host): Outcome {
  const n = native()
  const r = resolveAll(PATHS.skylight, [
    "SLSHWCaptureWindowList",
    "SLSHWCaptureWindowListInRect",
    "SLSMainConnectionID",
  ])
  const capture = fn(n.sym(PATHS.skylight, "SLSHWCaptureWindowList"), [u32, P, i32, u32], P)
  const mainCid = fn(n.sym(PATHS.skylight, "SLSMainConnectionID"), [], i32)
  if (!capture || !mainCid)
    return {
      verdict: "CONTRADICTS",
      resolves: "no",
      behaves: "-",
      measured: r.detail,
      reason: "symbol absent: SCK is the only capture path on this version",
    }
  if (!host.session.screenRecording) return unmeasured(grantReason(["Screen Recording"]), "yes", r.detail)
  const win = foreignWindow()
  if (!win) return unmeasured("no on-screen foreign window to capture", "yes", r.detail)
  // Options: ignore the global clip shape (1 << 11) and capture at the best resolution (1 << 8).
  const arr = capture(Number(mainCid()), new Uint32Array([win.id]), 1, (1 << 11) | (1 << 8)) as Pointer | null
  const images = arrayItems(arr)
  const img = images[0]
  let behaves = "no image"
  let ok = false
  if (img) {
    const w = Number(n.cg.CGImageGetWidth(img))
    const h = Number(n.cg.CGImageGetHeight(img))
    const data = n.cg.CGDataProviderCopyData(n.cg.CGImageGetDataProvider(img)) as Pointer | null
    let opaque = false
    if (data) {
      const len = Number(n.cf.CFDataGetLength(data))
      const bytes = new Uint8Array(toArrayBuffer(n.cf.CFDataGetBytePtr(data) as number, 0, len))
      for (let i = 0; i < bytes.length; i += 4) {
        if (bytes[i + 3] !== 0) {
          opaque = true
          break
        }
      }
      n.cf.CFRelease(data)
    }
    behaves = `image ${bucket8(w)}x${bucket8(h)} ${opaque ? "non-transparent" : "fully transparent"}`
    ok = w > 0 && h > 0 && opaque
  }
  if (arr) n.cf.CFRelease(arr)
  return {
    verdict: ok ? "CONFIRMS" : "CONTRADICTS",
    resolves: "yes",
    behaves,
    measured: `${r.detail};owner=${win.owner}`,
    reason: ok ? "-" : "resolves but returns no usable frame: SCK is the only capture path on this version",
  }
}

function qPostToPidResolve(): Outcome {
  const n = native()
  const sl = n.sym(PATHS.skylight, "SLEventPostToPid")
  const sls = n.sym(PATHS.skylight, "SLSEventPostToPid")
  const cgPub = n.sym(PATHS.cg, "CGEventPostToPid")
  const distinct = sl !== null && cgPub !== null && sl !== cgPub
  const resolves = sl !== null || sls !== null
  const measured = `SLEventPostToPid=${yesNo(sl)},SLSEventPostToPid=${yesNo(sls)},CGEventPostToPid=${yesNo(cgPub)},public_distinct=${yesNo(distinct)}`
  if (!resolves)
    return {
      verdict: "CONTRADICTS",
      resolves: "no",
      behaves: "-",
      measured,
      reason: "no SkyLight per-pid post: background delivery is the foreground lease only",
    }
  return {
    verdict: sls === null ? "NEW-EDGE" : "CONFIRMS",
    resolves: "yes",
    behaves: "-",
    measured,
    reason: sls === null ? "the plan's name SLSEventPostToPid is absent; the exported name is SLEventPostToPid" : "-",
  }
}

function qPostToPidDistinct(): Outcome {
  const n = native()
  const sl = n.sym(PATHS.skylight, "SLEventPostToPid")
  const cgPub = n.sym(PATHS.cg, "CGEventPostToPid")
  if (!sl || !cgPub) return unmeasured("one of SLEventPostToPid / CGEventPostToPid is absent", yesNo(sl && cgPub))
  const distinct = sl !== cgPub
  return {
    verdict: distinct ? "CONFIRMS" : "NEW-EDGE",
    resolves: "yes",
    behaves: distinct ? "distinct entry points" : "same entry point",
    measured: `public_distinct=${yesNo(distinct)}`,
    reason: distinct ? "-" : "CGEventPostToPid is the SkyLight entry point: a dual post double-delivers, post once",
  }
}

function qPostToPidEcho(host: Host): Outcome {
  const r = resolveAll(PATHS.skylight, ["SLEventPostToPid", "SLEventSetIntegerValueField", "CGEventSetWindowLocation"])
  const missing = [!host.session.accessibility && "Accessibility", !host.session.postEvent && "PostEvent"].filter(
    Boolean,
  ) as string[]
  if (missing.length > 0)
    return unmeasured(
      `${grantReason(missing)}; the echo leg needs the UI helper's receipt window (row 9 signs it)`,
      yesNo(r.all),
      r.detail,
    )
  return unmeasured(
    "the 2 s echo needs the UI helper's off-bounds receipt window, which row 9's signed helper provides",
    yesNo(r.all),
    r.detail,
  )
}

function qSetFront(host: Host): Outcome {
  const r = resolveAll(PATHS.skylight, ["SLSSetFrontProcessWithInfo", "kSLSSetFrontProcessRequestTimestampKey"])
  if (!r.all)
    return {
      verdict: "CONTRADICTS",
      resolves: "no",
      behaves: "-",
      measured: r.detail,
      reason: "hand-back falls back to NSRunningApplication.activate with the 250 ms-stable rule",
    }
  void host
  return unmeasured(
    "the -13066 user-race leg needs a HID-level user action between the timestamp and the call: H4 virtual HID is not given and no person is at H1",
    "yes",
    r.detail,
  )
}

function qRemoteToken(host: Host): Outcome {
  const n = native()
  const createTok = n.sym(PATHS.ax, "_AXUIElementRemoteTokenCreate")
  const fromTok = n.sym(PATHS.ax, "_AXUIElementCreateWithRemoteToken")
  const measuredNames = `_AXUIElementRemoteTokenCreate=${yesNo(createTok)},_AXUIElementCreateWithRemoteToken=${yesNo(fromTok)}`
  if (!createTok || !fromTok)
    return {
      verdict: "CONTRADICTS",
      resolves: "no",
      behaves: "-",
      measured: measuredNames,
      reason: "ref resolve keeps the retained AXUIElement object",
    }
  const win = foreignWindow()
  if (!win) return unmeasured("no on-screen foreign app to resolve", "yes", measuredNames)
  const create = CFunction({ ptr: createTok, args: [P], returns: P })
  const resolve = CFunction({ ptr: fromTok, args: [P], returns: P })
  const app = n.ax.AXUIElementCreateApplication(win.pid) as Pointer | null
  if (!app) return unmeasured("AXUIElementCreateApplication returned null", "yes", measuredNames)
  const token = create(app) as Pointer | null
  if (!token) {
    n.cf.CFRelease(app)
    if (!host.session.accessibility)
      return unmeasured(`${grantReason(["Accessibility"])}; token create returned null`, "yes", measuredNames)
    return {
      verdict: "CONTRADICTS",
      resolves: "yes",
      behaves: "token create returned null",
      measured: measuredNames,
      reason: "ref resolve keeps the retained AXUIElement object",
    }
  }
  const times: number[] = []
  let equal = true
  for (let i = 0; i < 200; i++) {
    const t0 = Bun.nanoseconds()
    const el = resolve(token) as Pointer | null
    times.push(Bun.nanoseconds() - t0)
    if (!el || !n.cf.CFEqual(el, app)) equal = false
    if (el) n.cf.CFRelease(el)
  }
  n.cf.CFRelease(token)
  n.cf.CFRelease(app)
  times.sort((a, b) => a - b)
  const p50ms = (times[100] ?? 0) / 1e6
  const ok = equal && p50ms < 1
  return {
    verdict: ok ? "CONFIRMS" : "CONTRADICTS",
    resolves: "yes",
    behaves: `round-trip ${equal ? "equal" : "unequal"}, p50 ${p50ms < 1 ? "<1" : ">=1"} ms`,
    measured: `${measuredNames};p50_ms=${p50ms.toFixed(4)};n=200;owner=${win.owner}`,
    reason: ok ? "-" : "resolve is not a sub-ms equal round trip: keep the retained object",
  }
}

function qCopySpaces(): Outcome {
  const n = native()
  const r = resolveAll(PATHS.skylight, [
    "SLSCopySpacesForWindows",
    "SLSGetActiveSpace",
    "SLSSpaceGetType",
    "SLSMainConnectionID",
  ])
  const copy = fn(n.sym(PATHS.skylight, "SLSCopySpacesForWindows"), [i32, i32, P], P)
  const active = fn(n.sym(PATHS.skylight, "SLSGetActiveSpace"), [i32], u64)
  const spaceType = fn(n.sym(PATHS.skylight, "SLSSpaceGetType"), [i32, u64], i32)
  const mainCid = fn(n.sym(PATHS.skylight, "SLSMainConnectionID"), [], i32)
  if (!copy || !active || !mainCid)
    return {
      verdict: "CONTRADICTS",
      resolves: "no",
      behaves: "-",
      measured: r.detail,
      reason: "no Space field: space:unknown with isOnScreen + AXMinimized",
    }
  const win = foreignWindow()
  if (!win) return unmeasured("no on-screen foreign window", "yes", r.detail)
  const cid = Number(mainCid())
  const num = cfNumber32(win.id)
  if (!num) return unmeasured("CFNumberCreate returned null", "yes", r.detail)
  const ids = cfArray([num])
  const spaces = copy(cid, 7, ids) as Pointer | null
  const list = arrayItems(spaces).map((v) => fromCfNumber(v))
  if (spaces) n.cf.CFRelease(spaces)
  if (ids) n.cf.CFRelease(ids)
  n.cf.CFRelease(num)
  const activeId = Number(active(cid))
  const type = spaceType ? Number(spaceType(cid, BigInt(activeId))) : -1
  const ok = list.length >= 1 && list.includes(activeId)
  return {
    verdict: ok ? "CONFIRMS" : "CONTRADICTS",
    resolves: "yes",
    behaves: ok
      ? "on-screen foreign window reports the active Space"
      : `spaces=${list.length}, active Space not among them`,
    measured: `${r.detail};spaces_for_window=${list.length};active_space_type=${type};owner=${win.owner}`,
    reason: ok ? "-" : "Space membership unreliable: space:unknown",
  }
}

function qMoveForeign(): Outcome {
  const n = native()
  const r = resolveAll(PATHS.skylight, ["SLSMoveWindowsToManagedSpace", "SLSCopyManagedDisplaySpaces"])
  if (!n.sym(PATHS.skylight, "SLSMoveWindowsToManagedSpace")) {
    return {
      verdict: "CONTRADICTS",
      resolves: "no",
      behaves: "-",
      measured: r.detail,
      reason: "capabilities.spaces.move:false",
    }
  }
  const managed = fn(n.sym(PATHS.skylight, "SLSCopyManagedDisplaySpaces"), [i32], P)
  const mainCid = fn(n.sym(PATHS.skylight, "SLSMainConnectionID"), [], i32)
  let userSpaces = -1
  if (managed && mainCid) {
    const displays = managed(Number(mainCid())) as Pointer | null
    userSpaces = 0
    for (const d of arrayItems(displays)) {
      for (const s of arrayItems(dictGet(d, "Spaces"))) {
        if (fromCfNumber(dictGet(s, "type")) === 0) userSpaces++
      }
    }
    if (displays) n.cf.CFRelease(displays)
  }
  if (userSpaces < 2) {
    return unmeasured(
      `the host has ${userSpaces < 0 ? "an unreadable number of" : userSpaces} user Space(s); a second Space would change the shared QA desktop, so the foreign move is not exercised`,
      "yes",
      `${r.detail};user_spaces=${userSpaces}`,
    )
  }
  return unmeasured(
    "a foreign-window move needs a fixture window the probe owns the lifetime of (row 40's live driver)",
    "yes",
    `${r.detail};user_spaces=${userSpaces}`,
  )
}

function readManagedPref(domain: string, key: string): string {
  const path = `/Library/Managed Preferences/${domain}.plist`
  if (!existsSync(path)) return "no-profile"
  const out = sh(["/usr/bin/defaults", "read", path.replace(/\.plist$/, ""), key])
  return out === "" ? "key-absent" : `value=${out}`
}

function qCaptureAlertPeriodic(host: Host): Outcome {
  const extra = `screen_recording=${yesNo(host.session.screenRecording)}`
  return unmeasured(
    "the periodic re-prompt recurs on a calendar scale (days); one probe run cannot observe it, and it applies only to a process holding the H3 Screen Recording grant",
    "-",
    extra,
  )
}

function qCaptureAlertBypass(): Outcome {
  const v = readManagedPref("com.apple.applicationaccess", "forceBypassScreenCaptureAlert")
  return unmeasured(
    v.startsWith("value=")
      ? "the key is installed but the alert it suppresses is calendar-scale (see the periodic row)"
      : "no MDM profile on this host installs forceBypassScreenCaptureAlert, so whether it applies cannot be measured",
    "-",
    `managed_pref=${v}`,
  )
}

function qOffConsole(host: Host, verb: "click" | "type"): Outcome {
  const facts = `on_console=${host.session.onConsole};screen_locked=${host.session.screenLocked}`
  if (host.session.onConsole !== "false") {
    return unmeasured(
      "needs the engine's session OFF the console (a fast user switch to a second QA account); this session is on the console",
      "-",
      facts,
    )
  }
  const missing = [!host.session.accessibility && "Accessibility", !host.session.postEvent && "PostEvent"].filter(
    Boolean,
  ) as string[]
  if (missing.length > 0)
    return unmeasured(
      `session is off the console, but ${grantReason(missing)}; the ${verb} leg reads its value back through AX`,
      "-",
      facts,
    )
  return unmeasured(
    `the ${verb} leg reads back through the VALUE verb of row 40's live driver, which does not exist yet`,
    "-",
    facts,
  )
}

function qAuthSymbol(): Outcome {
  const n = native()
  const setMsg = n.sym(PATHS.skylight, "SLEventSetAuthenticationMessage")
  const cls = n.objc.objc_getClass(cstr("SLSEventAuthenticationMessage")) as Pointer | null
  const sel = n.objc.sel_registerName(cstr("messageWithEventRecord:pid:version:")) as Pointer | null
  const factory = cls && sel ? (n.objc.class_getClassMethod(cls, sel) as Pointer | null) : null
  const measured = `SLEventSetAuthenticationMessage=${yesNo(setMsg)},SLSEventAuthenticationMessage_class=${yesNo(cls)},factory_selector=${yesNo(factory)}`
  const ok = Boolean(setMsg && cls && factory)
  return {
    verdict: ok ? "CONFIRMS" : "CONTRADICTS",
    resolves: yesNo(ok),
    behaves: "-",
    measured,
    reason: ok ? "-" : "no auth message on this version: Chromium background keys read pointer_only",
  }
}

function qAuthOffsets(): Outcome {
  const n = native()
  // kCGEventSourceStateCombinedSessionState = 0; kCGEventSourceUserData = field 42; kCGKeyboardEventKeycode = field 9.
  const source = n.cg.CGEventSourceCreate(0) as Pointer | null
  const event = n.cg.CGEventCreateKeyboardEvent(source, 0x2e, true) as Pointer | null
  if (!event)
    return {
      verdict: "CONTRADICTS",
      resolves: "-",
      behaves: "no event built",
      measured: "-",
      reason: "no event to scan: pointer_only",
    }
  const sentinel = crypto.getRandomValues(new BigUint64Array(1))[0] ?? 0n
  n.cg.CGEventSetIntegerValueField(event, 42, BigInt.asIntN(64, sentinel))
  n.cg.CGEventSetIntegerValueField(event, 9, 0x2e)
  const hits: number[] = []
  const positions: number[] = []
  const keycodeSeen: number[] = []
  for (const offset of [24, 32, 16]) {
    const slot = safeRead(Number(event) + offset, 8)
    if (!slot) continue
    const candidate = Number(new DataView(slot.buffer).getBigUint64(0, true))
    if (!candidate) continue
    const record = safeRead(candidate, 512)
    if (!record) continue
    const view = new DataView(record.buffer)
    for (let at = 0; at + 8 <= 512; at += 8) {
      if (view.getBigUint64(at, true) === sentinel) {
        hits.push(offset)
        positions.push(at)
        if (record.includes(0x2e)) keycodeSeen.push(offset)
        break
      }
    }
  }
  n.cf.CFRelease(event)
  if (source) n.cf.CFRelease(source)
  const measured = `hits=[${hits.join(",")}];sentinelAt=[${positions.join(",")}];keycode_corroborates=[${keycodeSeen.join(",")}]`
  if (hits.length === 1)
    return {
      verdict: "CONFIRMS",
      resolves: "-",
      behaves: `exactly one candidate (${hits[0]}) carries the sentinel`,
      measured,
      reason: "-",
    }
  return {
    verdict: "CONTRADICTS",
    resolves: "-",
    behaves: hits.length === 0 ? "no candidate carries the sentinel" : `${hits.length} candidates carry the sentinel`,
    measured,
    reason: "this version's fleet reads pointer_only",
  }
}

function appPresent(names: string[]): string | undefined {
  return names.find((name) => existsSync(`/Applications/${name}.app`))
}

function electronApps(): string[] {
  const out: string[] = []
  for (const dir of ["/Applications", `${process.env.HOME ?? ""}/Applications`]) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith(".app") && existsSync(`${dir}/${entry}/Contents/Frameworks/Electron Framework.framework`))
        out.push(entry)
    }
  }
  return out.sort()
}

function qAuthLive(host: Host, family: "TextEdit" | "Chrome" | "Electron"): Outcome {
  const app =
    family === "TextEdit"
      ? "TextEdit"
      : family === "Chrome"
        ? appPresent(["Google Chrome", "Chromium"])
        : electronApps()[0]
  const present = family === "TextEdit" ? existsSync("/System/Applications/TextEdit.app") : Boolean(app)
  const missing = [!host.session.accessibility && "Accessibility", !host.session.postEvent && "PostEvent"].filter(
    Boolean,
  ) as string[]
  const measured = `target_present=${yesNo(present)}`
  if (!present) return unmeasured(`no ${family} target installed on this host`, "-", measured)
  if (missing.length > 0)
    return unmeasured(
      `${grantReason(missing)}; the AC-20 typeText leg reads the typed value back through AX`,
      "-",
      measured,
    )
  return unmeasured("the AC-20 typeText leg is row 40's live driver, which does not exist yet", "-", measured)
}

function qWheel(host: Host, family: "TextEdit" | "Chrome" | "Electron"): Outcome {
  const present =
    family === "TextEdit"
      ? existsSync("/System/Applications/TextEdit.app")
      : family === "Chrome"
        ? Boolean(appPresent(["Google Chrome", "Chromium"]))
        : electronApps().length > 0
  const measured = `target_present=${yesNo(present)}`
  if (!present) return unmeasured(`no ${family} target installed on this host`, "-", measured)
  if (!host.session.accessibility)
    return unmeasured(
      `${grantReason(["Accessibility"])}; the scroll position is read before and after through AX`,
      "-",
      measured,
    )
  return unmeasured(
    "the AX before/after read of the wheel leg is row 40's live driver, which does not exist yet",
    "-",
    measured,
  )
}

function qElectronRightClick(host: Host): Outcome {
  const apps = electronApps()
  if (apps.length === 0) return unmeasured("no Electron app installed on this host", "-", "electron_apps=0")
  if (!host.session.accessibility)
    return unmeasured(
      `${grantReason(["Accessibility"])}; the refusal leg reads the context menu through AX`,
      "-",
      `electron_apps=${apps.length}`,
    )
  return unmeasured(
    "the background right-click leg is row 40's live driver, which does not exist yet",
    "-",
    `electron_apps=${apps.length}`,
  )
}

function qElectronFileTest(): Outcome {
  const apps = electronApps()
  const chrome = appPresent(["Google Chrome", "Chromium"])
  const chromeHasIt = chrome
    ? existsSync(`/Applications/${chrome}.app/Contents/Frameworks/Electron Framework.framework`)
    : false
  const measured = `electron_apps=${apps.length};chrome_present=${yesNo(chrome)};chrome_has_electron_framework=${yesNo(chromeHasIt)}`
  if (apps.length === 0)
    return unmeasured("no Electron app installed on this host to test the file against", "-", measured)
  return {
    verdict: chromeHasIt ? "CONTRADICTS" : "CONFIRMS",
    resolves: "-",
    behaves: chromeHasIt
      ? "a Chromium browser carries the framework"
      : "only Electron bundles carry Electron Framework.framework",
    measured,
    reason: chromeHasIt ? "the file test cannot separate the classes" : "-",
  }
}

function qPanelOwner(sandboxed: boolean): Outcome {
  return unmeasured(
    `needs the ${sandboxed ? "sandboxed" : "non-sandboxed"} QA fixture app that raises an Open panel (the fixture is signed with row 9's run-local identity)`,
  )
}

function qGsd40(host: Host, leg: "sck-alone" | "unanswered" | "expiry"): Outcome {
  const extra = `screen_recording=${yesNo(host.session.screenRecording)}`
  if (leg === "expiry")
    return unmeasured(
      "whether the replayd approval expires is calendar-scale; one probe run cannot observe it",
      "-",
      extra,
    )
  return unmeasured(
    `needs a ScreenCaptureKit caller holding the H3 Screen Recording grant (row 9's signed helper); ${extra.replace("=", " ")}`,
    "-",
    extra,
  )
}

function qSheetOwner(kind: "tcc" | "keychain" | "cfusernotification"): Outcome {
  if (kind === "tcc")
    return unmeasured("raising a TCC consent alert records a persistent TCC decision on the shared QA account")
  if (kind === "keychain")
    return unmeasured(
      "raising a Keychain access sheet queues SecurityAgent prompts on the shared QA account, which the fleet's standing rule forbids",
    )
  return unmeasured(
    "the alert is raised in the shared QA session by the fixture app of row 9; the probe raises no dialog on a shared session",
  )
}

function qSymbolOnly(path: string, names: string[], use: string): Outcome {
  const r = resolveAll(path, names)
  return {
    verdict: r.all ? "CONFIRMS" : "CONTRADICTS",
    resolves: yesNo(r.all),
    behaves: "-",
    measured: r.detail,
    reason: r.all ? `resolves; ${use} effect is not observed by a symbol probe` : `${use} unavailable on this version`,
  }
}

const QUESTIONS: Question[] = [
  {
    id: "hwcapture",
    subject: "SLSHWCaptureWindowList",
    condition: "capture of an on-screen foreign window",
    run: qHwCapture,
  },
  { id: "post-to-pid", subject: "SLSEventPostToPid", condition: "resolve", run: () => qPostToPidResolve() },
  {
    id: "post-to-pid-distinct",
    subject: "SLEventPostToPid",
    condition: "distinct from public CGEventPostToPid",
    run: () => qPostToPidDistinct(),
  },
  {
    id: "post-to-pid-echo",
    subject: "SLEventPostToPid",
    condition: "tagged pointer-pair echo within 2 s",
    run: qPostToPidEcho,
  },
  {
    id: "set-front",
    subject: "SLSSetFrontProcessWithInfo+kSLSSetFrontProcessRequestTimestampKey",
    condition: "-13066 on a user race",
    run: qSetFront,
  },
  {
    id: "ax-remote-token",
    subject: "_AXUIElementRemoteTokenCreate/_AXUIElementCreateWithRemoteToken",
    condition: "round trip, p50 < 1 ms",
    run: qRemoteToken,
  },
  {
    id: "copy-spaces",
    subject: "SLSCopySpacesForWindows",
    condition: "Space of an on-screen foreign window",
    run: () => qCopySpaces(),
  },
  {
    id: "move-space-foreign",
    subject: "SLSMoveWindowsToManagedSpace",
    condition: "move of a FOREIGN window, verified within 1200 ms",
    run: () => qMoveForeign(),
  },
  {
    id: "capture-alert-periodic",
    subject: "capture alert (15.1+)",
    condition: "periodic re-prompt without the picker",
    run: qCaptureAlertPeriodic,
  },
  {
    id: "capture-alert-bypass",
    subject: "forceBypassScreenCaptureAlert",
    condition: "managed preference applies",
    run: () => qCaptureAlertBypass(),
  },
  {
    id: "offconsole-click",
    subject: "SLEventPostToPid off console (AC-78 M3)",
    condition: "background click into TextEdit, value read back",
    run: (h) => qOffConsole(h, "click"),
  },
  {
    id: "offconsole-type",
    subject: "SLEventPostToPid off console (AC-78 M3)",
    condition: "background type into TextEdit, value read back",
    run: (h) => qOffConsole(h, "type"),
  },
  {
    id: "auth-message",
    subject: "SLSEventAuthenticationMessage+SLEventSetAuthenticationMessage",
    condition: "class, factory selector and setter resolve",
    run: () => qAuthSymbol(),
  },
  {
    id: "auth-offsets",
    subject: "__CGEvent record pointer at 24/32/16",
    condition: "random-sentinel hit set and sentinelAt",
    run: () => qAuthOffsets(),
  },
  {
    id: "auth-live-textedit",
    subject: "auth-message live leg (AC-20)",
    condition: "typeText into TextEdit",
    run: (h) => qAuthLive(h, "TextEdit"),
  },
  {
    id: "auth-live-chrome",
    subject: "auth-message live leg (AC-20)",
    condition: "typeText into Chrome",
    run: (h) => qAuthLive(h, "Chrome"),
  },
  {
    id: "auth-live-electron",
    subject: "auth-message live leg (AC-20)",
    condition: "typeText into an Electron app",
    run: (h) => qAuthLive(h, "Electron"),
  },
  {
    id: "panel-owner-sandboxed",
    subject: "Open/Save panel owner (CGWindowListCopyWindowInfo)",
    condition: "raised by a sandboxed fixture",
    run: () => qPanelOwner(true),
  },
  {
    id: "panel-owner-unsandboxed",
    subject: "Open/Save panel owner (CGWindowListCopyWindowInfo)",
    condition: "raised by a non-sandboxed fixture",
    run: () => qPanelOwner(false),
  },
  {
    id: "wheel-textedit",
    subject: "background wheel via the pid route",
    condition: "TextEdit, AX scroll position before/after",
    run: (h) => qWheel(h, "TextEdit"),
  },
  {
    id: "wheel-chrome",
    subject: "background wheel via the pid route",
    condition: "Chrome, AX scroll position before/after",
    run: (h) => qWheel(h, "Chrome"),
  },
  {
    id: "wheel-electron",
    subject: "background wheel via the pid route",
    condition: "Electron, AX scroll position before/after",
    run: (h) => qWheel(h, "Electron"),
  },
  {
    id: "electron-rightclick",
    subject: "Electron/Chromium background right-click",
    condition: "refusal leg",
    run: qElectronRightClick,
  },
  {
    id: "electron-file-test",
    subject: "Electron Framework.framework file test (OMPM-M4)",
    condition: "separates Electron from Chromium bundles",
    run: () => qElectronFileTest(),
  },
  {
    id: "gsd40-sck-alone",
    subject: "direct-capture consent (GSD-40)",
    condition: "SCShareableContent.current alone raises the alert",
    run: (h) => qGsd40(h, "sck-alone"),
  },
  {
    id: "gsd40-unanswered",
    subject: "direct-capture consent (GSD-40)",
    condition: "an unanswered alert blocks capture or only overlays",
    run: (h) => qGsd40(h, "unanswered"),
  },
  {
    id: "gsd40-expiry",
    subject: "direct-capture consent (GSD-40)",
    condition: "replayd approval expires and re-prompts",
    run: (h) => qGsd40(h, "expiry"),
  },
  {
    id: "owner-tcc-alert",
    subject: "TCC consent alert owner",
    condition: "CGWindowListCopyWindowInfo owner pid and name",
    run: () => qSheetOwner("tcc"),
  },
  {
    id: "owner-keychain-sheet",
    subject: "Keychain access sheet owner",
    condition: "CGWindowListCopyWindowInfo owner pid and name",
    run: () => qSheetOwner("keychain"),
  },
  {
    id: "owner-cfusernotification",
    subject: "CFUserNotificationDisplayAlert owner",
    condition: "CGWindowListCopyWindowInfo owner pid and name",
    run: () => qSheetOwner("cfusernotification"),
  },
  {
    id: "cps-release-key-focus",
    subject: "CPSReleaseKeyFocus",
    condition: "resolve",
    run: () => qSymbolOnly(PATHS.skylight, ["CPSReleaseKeyFocus"], "key-focus release"),
  },
  {
    id: "sets-cursor-in-background",
    subject: "SLSSetConnectionProperty(SetsCursorInBackground)",
    condition: "resolve",
    run: () => qSymbolOnly(PATHS.skylight, ["SLSSetConnectionProperty"], "cursor preservation"),
  },
]

// ---------------------------------------------------------------------------------------------------------------
// Ledger I/O

function rerunFor(id: string, major: number): string {
  return `bun ${PROBE_PATH} --row ${id} --macos ${major}`
}

function clean(s: string): string {
  return s.replace(/[\t\r\n]+/g, " ").trim() || "-"
}

function toLine(row: LedgerRow): string {
  return COLUMNS.map((c) => clean(String(row[c]))).join("\t")
}

function parseLedger(path: string): LedgerRow[] {
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
  const header = lines.shift()?.split("\t") ?? []
  if (header.join("\t") !== COLUMNS.join("\t")) throw new Error(`${path}: header is not the SP-M ledger header`)
  return lines.map((line) => {
    const cells = line.split("\t")
    const row = Object.fromEntries(COLUMNS.map((c, i) => [c, cells[i] ?? ""])) as unknown as LedgerRow
    return row
  })
}

function measureRow(q: Question, host: Host): LedgerRow {
  let outcome: Outcome
  try {
    outcome = q.run(host)
  } catch (error) {
    outcome = unmeasured(`probe error: ${(error as Error).message}`)
  }
  return {
    id: q.id,
    macos: String(host.major),
    subject: q.subject,
    condition: q.condition,
    rerun: rerunFor(q.id, host.major),
    host_build: host.build,
    ...outcome,
  }
}

function pendingRow(q: Question, major: number, reason: string): LedgerRow {
  return {
    id: q.id,
    macos: String(major),
    subject: q.subject,
    condition: q.condition,
    rerun: rerunFor(q.id, major),
    host_build: `none (${reason})`,
    ...unmeasured(reason),
  }
}

function buildHost(): Host {
  const { major, build } = precondition()
  return { major, build, session: sessionFacts() }
}

function printSession(host: Host): void {
  const s = host.session
  console.log(
    `SESSION macos=${host.build} manager=${s.manager} user=${s.user} console_user=${s.consoleUser} on_console=${s.onConsole} screen_locked=${s.screenLocked} accessibility=${s.accessibility} screen_recording=${s.screenRecording} post_event=${s.postEvent}`,
  )
}

// ---------------------------------------------------------------------------------------------------------------
// Main

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

function pendingReasons(args: string[]): Map<number, string> {
  const pending = new Map<number, string>()
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--pending") continue
    const [major, ...rest] = (args[i + 1] ?? "").split("=")
    pending.set(Number(major), rest.join("="))
  }
  return pending
}

function writeLedger(out: string, rows: LedgerRow[]): void {
  writeFileSync(out, `${[COLUMNS.join("\t"), ...rows.map(toLine)].join("\n")}\n`)
  for (const r of rows) console.log(`ROW ${r.id} macos=${r.macos} ${r.verdict}`)
  console.log(`WROTE ${out} rows=${rows.length}`)
}

// --pending-only: no host of either major is available, so nothing is measured and no precondition applies. Every
// row of every supported major is written UNMEASURED with that major's --pending reason.
function writePendingOnly(args: string[]): number {
  const out = argValue(args, "--out")
  const pending = pendingReasons(args)
  const absent = SUPPORTED_MAJORS.filter((m) => !pending.get(m))
  if (!out || absent.length > 0) {
    console.error(
      `SP-M: --pending-only needs --out <tsv> and a --pending reason for macOS ${absent.join(", ") || "each major"}`,
    )
    return 2
  }
  writeLedger(
    out,
    SUPPORTED_MAJORS.flatMap((major) => QUESTIONS.map((q) => pendingRow(q, major, pending.get(major) ?? ""))),
  )
  return 0
}

function main(args: string[]): number {
  const known = ["--measure", "--verify", "--row", "--session", "--pending-only"]
  if (!args.some((a) => known.includes(a))) {
    console.error(
      "usage: bun probe-sp-m.ts --measure --out <tsv> [--pending <major>=<reason>] | --pending-only --out <tsv> --pending 15=<reason> --pending 26=<reason> | --verify <tsv> | --row <id> [--macos <major>] | --session",
    )
    return 2
  }
  if (args.includes("--pending-only")) return writePendingOnly(args)
  const verifyPath = argValue(args, "--verify")
  if (args.includes("--verify") && (!verifyPath || !existsSync(verifyPath))) {
    console.error(`SP-M: ledger not found: ${verifyPath ?? "(missing path)"}`)
    return 2
  }
  const host = buildHost()
  printSession(host)

  if (args.includes("--session")) return 0

  if (args.includes("--row")) {
    const id = argValue(args, "--row")
    const wanted = argValue(args, "--macos")
    if (wanted && Number(wanted) !== host.major)
      fail(`a macOS ${wanted} host for this row; this host runs macOS ${host.build}`)
    const q = QUESTIONS.find((x) => x.id === id)
    if (!q) {
      console.error(`SP-M: unknown row id ${id}`)
      return 2
    }
    console.log(toLine(measureRow(q, host)))
    return 0
  }

  if (args.includes("--measure")) {
    const out = argValue(args, "--out")
    if (!out) {
      console.error("SP-M: --measure needs --out <tsv>")
      return 2
    }
    const pending = pendingReasons(args)
    const kept = existsSync(out) ? parseLedger(out).filter((r) => r.macos !== String(host.major)) : []
    const rows: LedgerRow[] = []
    for (const major of SUPPORTED_MAJORS) {
      if (major === host.major) {
        for (const q of QUESTIONS) rows.push(measureRow(q, host))
      } else if (pending.has(major)) {
        for (const q of QUESTIONS) rows.push(pendingRow(q, major, pending.get(major) ?? ""))
      } else {
        rows.push(...kept.filter((r) => r.macos === String(major)))
      }
    }
    writeLedger(out, rows)
    return 0
  }

  // --verify: re-measure every row the ledger records for this host's macOS major; the verdict column must match.
  const ledger = parseLedger(verifyPath as string)
  let compared = 0
  let differ = 0
  for (const row of ledger) {
    if (row.macos !== String(host.major)) {
      console.log(`SKIP ${row.id} macos=${row.macos} (this host runs macOS ${host.major})`)
      continue
    }
    const q = QUESTIONS.find((x) => x.id === row.id)
    if (!q) {
      console.log(`DIFF ${row.id} macos=${row.macos} ledger=${row.verdict} now=UNKNOWN-ROW`)
      differ++
      continue
    }
    const now = measureRow(q, host)
    compared++
    const same = now.verdict === row.verdict
    if (!same) differ++
    console.log(
      `${same ? "SAME" : "DIFF"} ${row.id} macos=${row.macos} ledger=${row.verdict} now=${now.verdict} measured=${now.measured}`,
    )
  }
  const ids = new Set(ledger.filter((r) => r.macos === String(host.major)).map((r) => r.id))
  for (const q of QUESTIONS) {
    if (!ids.has(q.id)) {
      console.log(`DIFF ${q.id} macos=${host.major} ledger=MISSING`)
      differ++
    }
  }
  console.log(`VERIFY compared=${compared} differ=${differ}`)
  return compared > 0 && differ === 0 ? 0 : 1
}

process.exit(main(Bun.argv.slice(2)))
