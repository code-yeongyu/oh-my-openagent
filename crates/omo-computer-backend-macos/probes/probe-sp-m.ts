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
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"

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
  // --with-capture: run the capture leg, which may raise the macOS 15.1+ capture reminder. Off by default.
  withCapture: boolean
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
    dlerror: { args: [], returns: cstring },
  })
  const handles = new Map<string, Pointer | null>()
  // dlerror() text of each image that failed to load: a load failure is recorded, never read as "symbol absent".
  const loadErrors = new Map<string, string>()
  const handle = (path: string): Pointer | null => {
    if (!handles.has(path)) {
      const h = sys.symbols.dlopen(cstr(path), 1) as Pointer | null
      if (!h) loadErrors.set(path, String(sys.symbols.dlerror() ?? "") || "dlopen returned null without dlerror text")
      handles.set(path, h)
    }
    return handles.get(path) ?? null
  }
  // symIn: only the named image (and what it re-exports). symAnywhere: every loaded image (RTLD_DEFAULT, (void *)-2).
  const symIn = (path: string, name: string): Pointer | null => {
    const h = handle(path)
    return h ? (sys.symbols.dlsym(h, cstr(name)) as Pointer | null) : null
  }
  const symAnywhere = (name: string): Pointer | null => sys.symbols.dlsym(RTLD_DEFAULT, cstr(name)) as Pointer | null
  // sym: the named image first, then any loaded image, so a symbol exported from another framework still resolves.
  const sym = (path: string, name: string): Pointer | null => symIn(path, name) ?? symAnywhere(name)
  const lookup = (path: string, name: string): Lookup => {
    const inImage = symIn(path, name) !== null
    const loadError = loadErrors.get(path)
    const where = symbolLocation(inImage, symAnywhere(name) !== null, loadError)
    return where === "load-error" && loadError !== undefined ? { name, where, loadError } : { name, where }
  }
  const locate = (path: string, name: string): SymbolLocation => lookup(path, name).where
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
  return { sys, sym, lookup, locate, taskSelf, cf: cf.symbols, cg: cg.symbols, ax: ax.symbols, objc: objc.symbols }
}

// RTLD_DEFAULT is the pointer value -2; bun:ffi takes it as an unsigned 64-bit bigint.
const RTLD_DEFAULT = 0xfffffffffffffffen

// Where a symbol was found: in the image the design names (`yes`), only in another loaded image (`elsewhere`),
// or nowhere (`no`). `elsewhere` counts as resolved: the ledger reads it differently from absent.
type SymbolLocation = "yes" | "elsewhere" | "no" | "load-error"
function symbolLocation(inImage: boolean, anywhere: boolean, loadError?: string): SymbolLocation {
  if (inImage) return "yes"
  if (anywhere) return "elsewhere"
  return loadError === undefined ? "no" : "load-error"
}

// One symbol lookup as the ledger sees it; `loadError` carries dlerror() text when the named image did not load.
interface Lookup {
  name: string
  where: SymbolLocation
  loadError?: string
}

// The negative verdict of a symbol row. A symbol is proven absent only when its image loaded and dlsym answered
// null; a framework that failed to load proves nothing, so that row is UNMEASURED with the loader's text.
function absenceOutcome(lookups: ReadonlyArray<Lookup>, measured: string, consequence: string): Outcome | undefined {
  const unresolved = lookups.filter((l) => l.where !== "yes" && l.where !== "elsewhere")
  if (unresolved.length === 0) return undefined
  const failed = unresolved.filter((l) => l.where === "load-error")
  if (failed.length > 0)
    return unmeasured(
      `image did not load, so absence is not proven: ${failed.map((l) => `${l.name}: ${l.loadError ?? "no loader text"}`).join("; ")}`,
      "-",
      measured,
    )
  return { verdict: "CONTRADICTS", resolves: "no", behaves: "-", measured, reason: consequence }
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

interface WindowFields {
  id: number | undefined
  pid: number | undefined
  layer: number | undefined
  owner: string
  x: number | undefined
  y: number | undefined
  w: number | undefined
  h: number | undefined
}

// A window-list entry whose id, owner pid, layer or bounds could not be read is dropped, never defaulted to 0: a
// made-up window id 0 would turn an unreadable entry into a capture or Space verdict.
function windowFromFields(f: WindowFields): WindowInfo | undefined {
  const { id, pid, layer, x, y, w, h } = f
  if (id === undefined || pid === undefined || layer === undefined) return undefined
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined
  return { id, pid, owner: f.owner, layer, bounds: { x, y, w, h } }
}

function windowList(option: number): WindowInfo[] {
  const n = native()
  const arr = n.cg.CGWindowListCopyWindowInfo(option, 0) as Pointer | null
  const out = arrayItems(arr).flatMap((d) => {
    const b = dictGet(d, "kCGWindowBounds")
    const bound = (key: string): number | undefined => (b ? fromCfNumber(dictGet(b, key)) : undefined)
    const win = windowFromFields({
      id: fromCfNumber(dictGet(d, "kCGWindowNumber")),
      pid: fromCfNumber(dictGet(d, "kCGWindowOwnerPID")),
      layer: fromCfNumber(dictGet(d, "kCGWindowLayer")),
      owner: fromCfString(dictGet(d, "kCGWindowOwnerName")),
      x: bound("X"),
      y: bound("Y"),
      w: bound("Width"),
      h: bound("Height"),
    })
    return win ? [win] : []
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

// `<name>=yes|elsewhere|no` for the measured column: every row that reports a C symbol uses this form.
function located(path: string, name: string): string {
  return `${name}=${native().locate(path, name)}`
}

// Lookups for an absenceOutcome: the symbols a row needs, each with where it was found or why it could not be.
function lookups(path: string, names: string[]): Lookup[] {
  const n = native()
  return names.map((name) => n.lookup(path, name))
}

function resolveAll(path: string, names: string[]): { all: boolean; detail: string; lookups: Lookup[] } {
  const found = lookups(path, names)
  return {
    all: found.every((l) => l.where === "yes" || l.where === "elsewhere"),
    detail: found.map((l) => `${l.name}=${l.where}`).join(","),
    lookups: found,
  }
}

function grantReason(missing: string[]): string {
  return `${missing.join(" + ")} not granted to this probe's responsible process (H3 is granted by row 9)`
}

// ---------------------------------------------------------------------------------------------------------------
// Questions. One entry per question per condition; the same list is measured on every macOS major.

function qHwCapture(host: Host): Outcome {
  // Gated like the consent rows: a legacy capture may raise the macOS 15.1+ capture reminder on a granted host, so
  // the probe runs it only when asked, and makes no native call otherwise.
  if (!host.withCapture)
    return unmeasured(
      "capture leg not run: it may raise the macOS 15.1+ capture reminder; rerun with --with-capture on a host where that is acceptable",
    )
  const n = native()
  const r = resolveAll(PATHS.skylight, [
    "SLSHWCaptureWindowList",
    "SLSHWCaptureWindowListInRect",
    "SLSMainConnectionID",
  ])
  const capture = fn(n.sym(PATHS.skylight, "SLSHWCaptureWindowList"), [u32, P, i32, u32], P)
  const mainCid = fn(n.sym(PATHS.skylight, "SLSMainConnectionID"), [], i32)
  const miss = absenceOutcome(
    r.lookups.filter((l) => l.name !== "SLSHWCaptureWindowListInRect"),
    r.detail,
    "symbol absent: SCK is the only capture path on this version",
  )
  if (miss) return miss
  if (!capture || !mainCid) return unmeasured("symbols resolved but could not be bound", "yes", r.detail)
  if (!host.session.screenRecording) return unmeasured(grantReason(["Screen Recording"]), "yes", r.detail)
  const win = foreignWindow()
  if (!win) return unmeasured("no on-screen foreign window to capture", "yes", r.detail)
  // Options: ignore the global clip shape (1 << 11) and capture at the best resolution (1 << 8).
  const arr = capture(Number(mainCid()), new Uint32Array([win.id]), 1, (1 << 11) | (1 << 8)) as Pointer | null
  const images = arrayItems(arr)
  const img = images[0]
  let decision: { verdict: Verdict; behaves: string } = { verdict: "CONTRADICTS", behaves: "no image" }
  if (img) {
    const w = Number(n.cg.CGImageGetWidth(img))
    const h = Number(n.cg.CGImageGetHeight(img))
    const provider = n.cg.CGImageGetDataProvider(img) as Pointer | null
    const data = provider ? (n.cg.CGDataProviderCopyData(provider) as Pointer | null) : null
    let bytes: Uint8Array | null = null
    if (data) {
      const len = Number(n.cf.CFDataGetLength(data))
      const bytePtr = n.cf.CFDataGetBytePtr(data) as Pointer | null
      // Copied out before the CFData is released.
      if (bytePtr && len > 0) bytes = new Uint8Array(toArrayBuffer(bytePtr, 0, len)).slice()
      n.cf.CFRelease(data)
    }
    decision = frameDecision(w, h, frameAlpha(bytes))
  }
  if (arr) n.cf.CFRelease(arr)
  const measured = `${r.detail};owner=${win.owner}`
  if (decision.verdict === "UNMEASURED")
    return unmeasured(
      `a frame came back but its pixel data could not be read (${decision.behaves}); transparency is not decided`,
      "yes",
      measured,
    )
  const ok = decision.verdict === "CONFIRMS"
  return {
    verdict: decision.verdict,
    resolves: "yes",
    behaves: decision.behaves,
    measured,
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
  const measured = `${located(PATHS.skylight, "SLEventPostToPid")},${located(PATHS.skylight, "SLSEventPostToPid")},${located(PATHS.cg, "CGEventPostToPid")},public_distinct=${yesNo(distinct)}`
  if (!resolves)
    return (
      absenceOutcome(
        lookups(PATHS.skylight, ["SLEventPostToPid", "SLSEventPostToPid"]),
        measured,
        "no SkyLight per-pid post: background delivery is the foreground lease only",
      ) ?? unmeasured("lookup answered neither present nor absent", "-", measured)
    )
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
  const where = `${located(PATHS.skylight, "SLEventPostToPid")},${located(PATHS.cg, "CGEventPostToPid")}`
  if (!sl || !cgPub)
    return unmeasured("one of SLEventPostToPid / CGEventPostToPid is absent", yesNo(sl && cgPub), where)
  const distinct = sl !== cgPub
  return {
    verdict: distinct ? "CONFIRMS" : "NEW-EDGE",
    resolves: "yes",
    behaves: distinct ? "distinct entry points" : "same entry point",
    measured: `${where};public_distinct=${yesNo(distinct)}`,
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
  const miss = absenceOutcome(
    r.lookups,
    r.detail,
    "hand-back falls back to NSRunningApplication.activate with the 250 ms-stable rule",
  )
  if (miss) return miss
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
  const measuredNames = `${located(PATHS.ax, "_AXUIElementRemoteTokenCreate")},${located(PATHS.ax, "_AXUIElementCreateWithRemoteToken")}`
  const miss = absenceOutcome(
    lookups(PATHS.ax, ["_AXUIElementRemoteTokenCreate", "_AXUIElementCreateWithRemoteToken"]),
    measuredNames,
    "ref resolve keeps the retained AXUIElement object",
  )
  if (miss) return miss
  if (!createTok || !fromTok) return unmeasured("symbols resolved but could not be bound", "yes", measuredNames)
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

// The copy-spaces decision. An on-screen window is on its display's current Space, so the list
// SLSCopySpacesForWindows returns for it must contain that id. `unread` (never a negative verdict) when the current
// Space reads 0, the list is empty, or an entry could not be read and no readable entry matches.
function spaceDecision(spaces: ReadonlyArray<number | undefined>, currentSpace: number): "on" | "off" | "unread" {
  if (currentSpace === 0 || spaces.length === 0) return "unread"
  if (spaces.includes(currentSpace)) return "on"
  return spaces.includes(undefined) ? "unread" : "off"
}

// The hwcapture verdict for one returned frame. `alpha` is `unread` when the image's data provider or its bytes
// could not be read: that is not a frame property, so it is never 'fully transparent' and never CONTRADICTS.
function frameDecision(
  w: number,
  h: number,
  alpha: "opaque" | "transparent" | "unread",
): { verdict: Verdict; behaves: string } {
  if (alpha === "unread")
    return { verdict: "UNMEASURED", behaves: `image ${bucket8(w)}x${bucket8(h)}, pixel data unreadable` }
  const opaque = alpha === "opaque"
  const ok = w > 0 && h > 0 && opaque
  return {
    verdict: ok ? "CONFIRMS" : "CONTRADICTS",
    behaves: `image ${bucket8(w)}x${bucket8(h)} ${opaque ? "non-transparent" : "fully transparent"}`,
  }
}

// The auth-offsets verdict. An unreadable candidate pointer is a failed candidate (the design's fail-closed
// exception: the runtime degrades to pointer_only), and the ledger names it in `measured`.
function authOffsetsOutcome(hits: number[], positions: number[], unreadable: number[]): Outcome {
  const measured = `hits=[${hits.join(",")}];sentinelAt=[${positions.join(",")}];unreadable=${unreadable.length}[${unreadable.join(",")}]`
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
    reason:
      unreadable.length > 0
        ? "this version's fleet reads pointer_only (fail-closed: an unreadable candidate counts as a failed candidate)"
        : "this version's fleet reads pointer_only",
  }
}

// The alpha class of a frame's RGBA bytes: `unread` when no bytes could be read (null or empty), `opaque` when any
// pixel has a non-zero alpha byte, else `transparent`.
function frameAlpha(bytes: Uint8Array | null): "opaque" | "transparent" | "unread" {
  if (!bytes || bytes.length === 0) return "unread"
  for (let i = 3; i < bytes.length; i += 4) {
    if (bytes[i] !== 0) return "opaque"
  }
  return "transparent"
}

// The auth-offsets scan over the three candidate slots of an event record. `read` returns null for an unreadable
// address; the scan records that candidate as unreadable, never as a clean miss.
function scanCandidates(
  read: (address: number, size: number) => Uint8Array | null,
  eventAddress: number,
  sentinel: bigint,
): { hits: number[]; positions: number[]; unreadable: number[] } {
  const hits: number[] = []
  const positions: number[] = []
  const unreadable: number[] = []
  for (const offset of [24, 32, 16]) {
    const slot = read(eventAddress + offset, 8)
    if (!slot) {
      unreadable.push(offset)
      continue
    }
    const candidate = Number(new DataView(slot.buffer, slot.byteOffset, 8).getBigUint64(0, true))
    if (!candidate) continue
    const record = read(candidate, 512)
    if (!record) {
      unreadable.push(offset)
      continue
    }
    const view = new DataView(record.buffer, record.byteOffset, record.byteLength)
    for (let at = 0; at + 8 <= record.byteLength; at += 8) {
      if (view.getBigUint64(at, true) === sentinel) {
        hits.push(offset)
        positions.push(at)
        break
      }
    }
  }
  return { hits, positions, unreadable }
}

function qCopySpaces(): Outcome {
  const n = native()
  const r = resolveAll(PATHS.skylight, [
    "SLSCopySpacesForWindows",
    "SLSCopyManagedDisplayForWindow",
    "SLSManagedDisplayGetCurrentSpace",
    "SLSSpaceGetType",
    "SLSMainConnectionID",
  ])
  const copy = fn(n.sym(PATHS.skylight, "SLSCopySpacesForWindows"), [i32, i32, P], P)
  const displayFor = fn(n.sym(PATHS.skylight, "SLSCopyManagedDisplayForWindow"), [i32, u32], P)
  const currentSpace = fn(n.sym(PATHS.skylight, "SLSManagedDisplayGetCurrentSpace"), [i32, P], u64)
  const spaceType = fn(n.sym(PATHS.skylight, "SLSSpaceGetType"), [i32, u64], i32)
  const mainCid = fn(n.sym(PATHS.skylight, "SLSMainConnectionID"), [], i32)
  const miss = absenceOutcome(
    r.lookups.filter((l) => l.name !== "SLSSpaceGetType"),
    r.detail,
    "no Space field: space:unknown with isOnScreen + AXMinimized",
  )
  if (miss) return miss
  if (!copy || !displayFor || !currentSpace || !mainCid)
    return unmeasured("symbols resolved but could not be bound", "yes", r.detail)
  const win = foreignWindow()
  if (!win) return unmeasured("no on-screen foreign window", "yes", r.detail)
  const cid = Number(mainCid())
  const num = cfNumber32(win.id)
  if (!num) return unmeasured("CFNumberCreate returned null", "yes", r.detail)
  const ids = cfArray([num])
  if (!ids) {
    n.cf.CFRelease(num)
    return unmeasured("CFArrayCreate returned null; the window's Spaces were not read", "yes", r.detail)
  }
  const spaces = copy(cid, 7, ids) as Pointer | null
  const list = arrayItems(spaces).map((v) => fromCfNumber(v))
  if (spaces) n.cf.CFRelease(spaces)
  n.cf.CFRelease(ids)
  n.cf.CFRelease(num)
  // Compare with the current Space of the window's OWN display, not the focused display's active Space: on a
  // multi-display host a foreign window on the other display is on that display's current Space.
  const display = displayFor(cid, win.id) as Pointer | null
  if (!display) return unmeasured("SLSCopyManagedDisplayForWindow returned no display", "yes", r.detail)
  const currentId = Number(currentSpace(cid, display))
  n.cf.CFRelease(display)
  const type = spaceType ? Number(spaceType(cid, BigInt(currentId))) : -1
  const decision = spaceDecision(list, currentId)
  if (decision === "unread")
    return unmeasured(
      "the display's current Space read as 0, or the window's Space list was empty or had an unreadable entry; membership is not decided",
      "yes",
      `${r.detail};spaces_for_window=${list.length};owner=${win.owner}`,
    )
  const ok = decision === "on"
  return {
    verdict: ok ? "CONFIRMS" : "CONTRADICTS",
    resolves: "yes",
    behaves: ok
      ? "on-screen foreign window reports its display's current Space"
      : `spaces=${list.length}, its display's current Space not among them`,
    measured: `${r.detail};spaces_for_window=${list.length};current_space_type=${type};owner=${win.owner}`,
    reason: ok ? "-" : "Space membership unreliable: space:unknown",
  }
}

function qMoveForeign(): Outcome {
  const n = native()
  const r = resolveAll(PATHS.skylight, ["SLSMoveWindowsToManagedSpace", "SLSCopyManagedDisplaySpaces"])
  const miss = absenceOutcome(
    r.lookups.filter((l) => l.name === "SLSMoveWindowsToManagedSpace"),
    r.detail,
    "capabilities.spaces.move:false",
  )
  if (miss) return miss
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
  // The class and selector come from the Objective-C runtime, which has no per-image answer: yes / no only.
  const measured = `${located(PATHS.skylight, "SLEventSetAuthenticationMessage")},SLSEventAuthenticationMessage_class=${yesNo(cls)},factory_selector=${yesNo(factory)}`
  const ok = Boolean(setMsg && cls && factory)
  if (!setMsg) {
    const miss = absenceOutcome(
      lookups(PATHS.skylight, ["SLEventSetAuthenticationMessage"]),
      measured,
      "no auth message on this version: Chromium background keys read pointer_only",
    )
    if (miss) return miss
  }
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
  const { hits, positions, unreadable } = scanCandidates(safeRead, Number(event), sentinel)
  n.cf.CFRelease(event)
  if (source) n.cf.CFRelease(source)
  // Only the sentinel decides. A keycode byte is not recorded: one 0x2e byte somewhere in 512 bytes of
  // pointer-filled memory proves nothing about where the keycode field sits.
  return authOffsetsOutcome(hits, positions, unreadable)
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
  const miss = absenceOutcome(r.lookups, r.detail, `${use} unavailable on this version`)
  if (miss) return miss
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

// Command-line options that change what a measuring run does.
function hostOptions(args: string[]): { withCapture: boolean } {
  return { withCapture: args.includes("--with-capture") }
}

// Assembles a Host from its three sources; buildHost passes the live ones, the self-test passes fixed ones.
function hostFromParts(
  facts: { major: number; build: string },
  session: SessionFacts,
  options: { withCapture: boolean },
): Host {
  return { major: facts.major, build: facts.build, session, ...options }
}

function buildHost(args: string[]): Host {
  return hostFromParts(precondition(), sessionFacts(), hostOptions(args))
}

// Reads an existing ledger. A file that is not an SP-M ledger is an error value, never a thrown stack trace.
function readLedger(path: string): { rows: LedgerRow[] } | { error: string } {
  try {
    return { rows: parseLedger(path) }
  } catch (error) {
    return { error: (error as Error).message.split("\n")[0] ?? "unreadable ledger" }
  }
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

// Every `--pending <major>=<reason>` pair. A pair with an unsupported major or an empty reason is refused: an empty
// reason would write UNMEASURED rows that say nothing about why.
function parsePending(args: string[]): { pending: Map<number, string>; error?: string } {
  const pending = new Map<number, string>()
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--pending") continue
    const pair = args[i + 1] ?? ""
    const eq = pair.indexOf("=")
    const major = Number(eq >= 0 ? pair.slice(0, eq) : pair)
    const reason = eq >= 0 ? pair.slice(eq + 1).trim() : ""
    if (!SUPPORTED_MAJORS.includes(major as 15 | 26))
      return { pending, error: `--pending '${pair}' names no supported macOS major (15, 26)` }
    if (reason === "") return { pending, error: `--pending '${pair}' has an empty reason` }
    pending.set(major, reason)
  }
  return { pending }
}

// A major is covered when it has a --pending reason or the existing ledger already holds a row for every question
// on it. The ledger grammar is every question on every supported major (32 x 2), never fewer.
function uncoveredMajors(pending: ReadonlyMap<number, string>, existing: ReadonlyArray<LedgerRow>): number[] {
  return SUPPORTED_MAJORS.filter((major) => {
    if (pending.has(major)) return false
    const ids = new Set(existing.filter((r) => r.macos === String(major)).map((r) => r.id))
    return !QUESTIONS.every((q) => ids.has(q.id))
  })
}

// --verify passes only when no verdict changed AND at least one row was actually measured: a ledger whose rows are
// all UNMEASURED, re-run on a host that still measures nothing, is identical but proves nothing.
function verifySummary(compared: number, unmeasuredNow: number, differ: number): { line: string; pass: boolean } {
  const measured = compared - unmeasuredNow
  return {
    line: `VERIFY compared=${compared} measured=${measured} unmeasured=${unmeasuredNow} differ=${differ}`,
    pass: differ === 0 && measured > 0,
  }
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
  const { pending, error } = parsePending(args)
  if (error) {
    console.error(`SP-M: ${error}`)
    return 2
  }
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

// ---------------------------------------------------------------------------------------------------------------
// Self-test (--self-test): the pure decisions of the probe, checked on any host, Linux included. No native call.

function selfTest(): number {
  const failures: string[] = []
  const expect = (name: string, ok: () => boolean): void => {
    let pass = false
    try {
      pass = ok()
    } catch (error) {
      failures.push(`${name} (threw: ${(error as Error).message.split("\n")[0]})`)
      return
    }
    if (!pass) failures.push(name)
  }
  // --verify gate
  expect("verifySummary: nothing measured is never a pass", () => !verifySummary(32, 32, 0).pass)
  expect("verifySummary: prints the unmeasured count", () => verifySummary(32, 32, 0).line.includes("unmeasured=32"))
  expect("verifySummary: one measured row and no diff passes", () => verifySummary(32, 31, 0).pass)
  expect("verifySummary: a diff fails", () => !verifySummary(32, 0, 1).pass)
  // ledger grammar
  const rows26 = QUESTIONS.map((q) => pendingRow(q, 26, "r"))
  expect(
    "uncoveredMajors: nothing pending, no ledger -> 15 and 26",
    () => uncoveredMajors(new Map(), []).join() === "15,26",
  )
  expect("uncoveredMajors: 15 pending -> 26", () => uncoveredMajors(new Map([[15, "r"]]), []).join() === "26")
  expect(
    "uncoveredMajors: a full 26 ledger covers 26",
    () => uncoveredMajors(new Map([[15, "r"]]), rows26).length === 0,
  )
  expect(
    "uncoveredMajors: a ledger missing one 26 row does not",
    () => uncoveredMajors(new Map([[15, "r"]]), rows26.slice(1)).join() === "26",
  )
  expect("parsePending: empty reason refused", () => Boolean(parsePending(["--pending", "15="]).error))
  expect("parsePending: blank reason refused", () => Boolean(parsePending(["--pending", "15=  "]).error))
  expect("parsePending: unsupported major refused", () => Boolean(parsePending(["--pending", "14=r"]).error))
  expect(
    "parsePending: a reason is kept",
    () => parsePending(["--pending", "15=awaiting H2"]).pending.get(15) === "awaiting H2",
  )
  // copy-spaces decision
  expect("spaceDecision: on its display's current Space", () => spaceDecision([3, 7], 7) === "on")
  expect("spaceDecision: an unread current Space (0) never matches", () => spaceDecision([0], 0) !== "on")
  // swallowed errors: a failure to read or load is never a negative verdict
  expect("spaceDecision: an unread current Space (0) is 'unread', not 'off'", () => spaceDecision([3], 0) === "unread")
  expect(
    "spaceDecision: on and off still decide",
    () => spaceDecision([7], 7) === "on" && spaceDecision([3], 7) === "off",
  )
  expect(
    "symbolLocation: an image that failed to load and no symbol anywhere is 'load-error'",
    () => symbolLocation(false, false, "image not found") === "load-error",
  )
  expect(
    "symbolLocation: found elsewhere despite a load error is 'elsewhere'",
    () => symbolLocation(false, true, "image not found") === "elsewhere",
  )
  expect("symbolLocation: loaded image, no symbol is 'no'", () => symbolLocation(false, false) === "no")
  const loadErr: Lookup = { name: "SLEventPostToPid", where: "load-error", loadError: "image not found" }
  const absent: Lookup = { name: "SLSEventPostToPid", where: "no" }
  expect("absenceOutcome: a load error is UNMEASURED with the loader text, never CONTRADICTS", () => {
    const o = absenceOutcome([loadErr], "m", "c")
    return o?.verdict === "UNMEASURED" && o.reason.includes("image not found")
  })
  expect(
    "absenceOutcome: absent + load error is still UNMEASURED",
    () => absenceOutcome([absent, loadErr], "m", "c")?.verdict === "UNMEASURED",
  )
  expect(
    "absenceOutcome: a proven absence is CONTRADICTS",
    () => absenceOutcome([absent], "m", "c")?.verdict === "CONTRADICTS",
  )
  expect(
    "absenceOutcome: all resolved gives no negative",
    () =>
      absenceOutcome(
        [
          { name: "a", where: "yes" },
          { name: "b", where: "elsewhere" },
        ],
        "m",
        "c",
      ) === undefined,
  )
  const fields: WindowFields = { id: 9, pid: 42, layer: 0, owner: "o", x: 0, y: 0, w: 640, h: 480 }
  expect("windowFromFields: a complete entry is kept", () => windowFromFields(fields)?.id === 9)
  expect(
    "windowFromFields: an unreadable id drops the entry",
    () => windowFromFields({ ...fields, id: undefined }) === undefined,
  )
  expect(
    "windowFromFields: an unreadable layer drops the entry",
    () => windowFromFields({ ...fields, layer: undefined }) === undefined,
  )
  expect(
    "windowFromFields: unreadable bounds drop the entry",
    () => windowFromFields({ ...fields, w: undefined }) === undefined,
  )
  // fold of the review at bd138d2e74
  expect("frameDecision: an unread data provider is UNMEASURED, not 'fully transparent'", () => {
    const d = frameDecision(640, 480, "unread")
    return d.verdict === "UNMEASURED" && !d.behaves.includes("fully transparent")
  })
  expect(
    "frameDecision: a transparent frame is CONTRADICTS",
    () => frameDecision(640, 480, "transparent").verdict === "CONTRADICTS",
  )
  expect("frameDecision: an opaque frame CONFIRMS", () => frameDecision(640, 480, "opaque").verdict === "CONFIRMS")
  expect(
    "spaceDecision: an unreadable Space entry is 'unread', not 'off'",
    () => spaceDecision([3, undefined], 7) === "unread",
  )
  expect("spaceDecision: a readable match still decides 'on'", () => spaceDecision([7, undefined], 7) === "on")
  expect("spaceDecision: an empty list is 'unread', not 'off'", () => spaceDecision([], 7) === "unread")
  expect("authOffsetsOutcome: unreadable candidates are counted and named in measured", () => {
    const o = authOffsetsOutcome([], [], [24, 32])
    return o.measured.includes("unreadable=2[24,32]") && o.reason.includes("fail-closed")
  })
  expect("authOffsetsOutcome: a clean read with no hit reports unreadable=0", () =>
    authOffsetsOutcome([], [], []).measured.includes("unreadable=0[]"),
  )
  expect("hostOptions: no flag leaves the capture leg off", () => hostOptions(["--measure"]).withCapture === false)
  expect(
    "hostOptions: --with-capture turns it on",
    () => hostOptions(["--verify", "x", "--with-capture"]).withCapture === true,
  )
  // a file that is not an SP-M ledger: one-line refusal, exit 2
  const bad = `${process.env.TMPDIR ?? "/tmp"}/sp-m-self-test-${process.pid}.tsv`
  writeFileSync(bad, "not\ta\tledger\n")
  expect("readLedger: a bad header is an error value", () => {
    const r = readLedger(bad)
    return "error" in r && !r.error.includes("\n")
  })
  // Run as a child so a thrown stack trace or a host-precondition exit shows up as what it is.
  const cli = (argv: string[]): { code: number; stderrLines: number } => {
    const res = Bun.spawnSync({ cmd: [process.execPath, import.meta.path, ...argv], stdout: "pipe", stderr: "pipe" })
    const stderr = res.stderr.toString().trim()
    return { code: res.exitCode ?? -1, stderrLines: stderr === "" ? 0 : stderr.split("\n").length }
  }
  expect("cli: --measure over a bad-header ledger exits 2 with one line", () => {
    const r = cli(["--measure", "--out", bad, "--pending", "15=r", "--pending", "26=r"])
    return r.code === 2 && r.stderrLines === 1
  })
  expect("cli: --verify of a bad-header ledger exits 2 with one line", () => {
    const r = cli(["--verify", bad])
    return r.code === 2 && r.stderrLines === 1
  })
  rmSync(bad, { force: true })
  // the capture leg is gated: without --with-capture it is UNMEASURED and makes no native call
  const granted: Host = {
    major: 26,
    build: "self-test",
    withCapture: false,
    session: {
      manager: "Aqua",
      user: "-",
      consoleUser: "-",
      onConsole: "true",
      screenLocked: "false",
      accessibility: true,
      screenRecording: true,
      postEvent: true,
    },
  }
  expect("qHwCapture: without --with-capture it is UNMEASURED and names the flag", () => {
    const o = qHwCapture(granted)
    return o.verdict === "UNMEASURED" && o.reason.includes("--with-capture")
  })
  // fold of the review at f3ccccdc75: pure seams for the macOS-only paths
  expect(
    "hostFromParts: --with-capture reaches the Host",
    () => hostFromParts({ major: 26, build: "b" }, granted.session, { withCapture: true }).withCapture === true,
  )
  expect(
    "hostFromParts: no flag leaves it off",
    () => hostFromParts({ major: 26, build: "b" }, granted.session, { withCapture: false }).withCapture === false,
  )
  expect(
    "frameAlpha: no bytes is 'unread'",
    () => frameAlpha(null) === "unread" && frameAlpha(new Uint8Array(0)) === "unread",
  )
  expect(
    "frameAlpha: all-zero alpha is 'transparent'",
    () => frameAlpha(new Uint8Array([9, 9, 9, 0, 9, 9, 9, 0])) === "transparent",
  )
  expect(
    "frameAlpha: one non-zero alpha byte is 'opaque'",
    () => frameAlpha(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 7])) === "opaque",
  )
  // a fake address space: event at 0x1000; slot 24 unreadable, slot 32 -> record with the sentinel at byte 40,
  // slot 16 -> a record address that cannot be read
  const sentinel = 0x1122334455667788n
  const record = new Uint8Array(512)
  new DataView(record.buffer).setBigUint64(40, sentinel, true)
  const word = (v: number): Uint8Array => {
    const b = new Uint8Array(8)
    new DataView(b.buffer).setBigUint64(0, BigInt(v), true)
    return b
  }
  const memory = new Map<number, Uint8Array>([
    [0x1000 + 32, word(0x2000)],
    [0x1000 + 16, word(0x3000)],
    [0x2000, record],
  ])
  const scan = scanCandidates((address) => memory.get(address) ?? null, 0x1000, sentinel)
  expect(
    "scanCandidates: the sentinel record is the one hit, at its position",
    () => scan.hits.join() === "32" && scan.positions.join() === "40",
  )
  expect(
    "scanCandidates: an unreadable slot and an unreadable record are both named",
    () => scan.unreadable.join() === "24,16",
  )
  // the README lists every self-test group (the text before ':' of each check name), and nothing else
  expect("readme: the self-test list names exactly the self-test groups", () => {
    const source = readFileSync(import.meta.path, "utf8")
    const groups = new Set([...source.matchAll(/expect\(\s*"([^":]+):/g)].map((m) => m[1] ?? ""))
    const readme = readFileSync(`${import.meta.dir}/README.md`, "utf8")
    const start = readme.indexOf("### Self-test checks")
    if (start < 0) return false
    const section = readme.slice(start).split("\n").slice(1)
    const end = section.findIndex((l) => l.startsWith("#"))
    const listed = new Set(
      (end < 0 ? section : section.slice(0, end)).flatMap((l) => {
        const m = /^- `([^`]+)`/.exec(l)
        return m?.[1] ? [m[1]] : []
      }),
    )
    return groups.size === listed.size && [...groups].every((g) => listed.has(g))
  })
  for (const f of failures) console.log(`SELF-TEST FAIL ${f}`)
  console.log(failures.length > 0 ? `SELF-TEST FAIL ${failures.length}` : "SELF-TEST PASS")
  return failures.length > 0 ? 1 : 0
}

function main(args: string[]): number {
  if (args.includes("--self-test")) return selfTest()
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
  // --measure arguments are checked before the host: at most ONE major (the host's own) may be left uncovered.
  const measureOut = argValue(args, "--out")
  const { pending, error } = parsePending(args)
  const existingRead = measureOut && existsSync(measureOut) ? readLedger(measureOut) : { rows: [] }
  if ("error" in existingRead) {
    console.error(`SP-M: ${existingRead.error}`)
    return 2
  }
  const existing = existingRead.rows
  const verifyRead = verifyPath ? readLedger(verifyPath) : { rows: [] }
  if ("error" in verifyRead) {
    console.error(`SP-M: ${verifyRead.error}`)
    return 2
  }
  if (args.includes("--measure")) {
    if (!measureOut || error) {
      console.error(`SP-M: ${error ?? "--measure needs --out <tsv>"}`)
      return 2
    }
    const uncovered = uncoveredMajors(pending, existing)
    if (uncovered.length > 1) {
      console.error(
        `SP-M: --measure covers one major (the host's); macOS ${uncovered.join(" and ")} lack ledger rows and a --pending reason`,
      )
      return 2
    }
  }
  const host = buildHost(args)
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
    const out = measureOut ?? ""
    const uncovered = uncoveredMajors(pending, existing).filter((m) => m !== host.major)
    if (uncovered.length > 0) {
      console.error(`SP-M: macOS ${uncovered.join(", ")} lacks ledger rows and a --pending reason`)
      return 2
    }
    const kept = existing.filter((r) => r.macos !== String(host.major))
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
    if (rows.length !== SUPPORTED_MAJORS.length * QUESTIONS.length) {
      console.error(`SP-M: refusing a ledger of ${rows.length} rows; the grammar is ${QUESTIONS.length} x 2`)
      return 2
    }
    writeLedger(out, rows)
    return 0
  }

  // --verify: re-measure every row the ledger records for this host's macOS major; the verdict column must match.
  const ledger = verifyRead.rows
  let compared = 0
  let unmeasuredNow = 0
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
    if (now.verdict === "UNMEASURED") unmeasuredNow++
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
  const summary = verifySummary(compared, unmeasuredNow, differ)
  console.log(summary.line)
  return summary.pass ? 0 : 1
}

if (import.meta.main) process.exit(main(Bun.argv.slice(2)))
