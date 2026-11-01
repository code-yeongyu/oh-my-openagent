import { stat } from "node:fs/promises"

export const KEYCHAIN_HELPER_REQUIREMENT =
  'identifier "com.mengmota.omo-keychain-helper" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] ' +
  'and certificate leaf[field.1.2.840.113635.100.6.1.13] and certificate leaf[subject.OU] = "523JNR86LZ"'

export type SignatureVerdict = "valid" | "invalid" | "missing"

/** Checks one file against a designated requirement. Injected in tests; production uses `verifyWithSecurityFramework`. */
export type RequirementCheck = (path: string, requirement: string) => Promise<boolean>

// kSecCSStrictValidate | kSecCSCheckAllArchitectures (design 1, "Checking the helper").
const STRICT_ALL_ARCHITECTURES = (1 << 4) | (1 << 0)
const UTF8 = 0x08000100

type SecurityFunctions = {
  readonly check: (path: string, requirement: string) => boolean
}

let security: SecurityFunctions | null | undefined

async function loadSecurity(): Promise<SecurityFunctions | null> {
  if (security !== undefined) return security
  try {
    const { dlopen, FFIType, ptr } = await import("bun:ffi")
    const cf = dlopen("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation", {
      CFStringCreateWithCString: { args: [FFIType.u64, FFIType.ptr, FFIType.u32], returns: FFIType.u64 },
      CFURLCreateFromFileSystemRepresentation: { args: [FFIType.u64, FFIType.ptr, FFIType.i64, FFIType.bool], returns: FFIType.u64 },
      CFRelease: { args: [FFIType.u64], returns: FFIType.void },
    })
    const sec = dlopen("/System/Library/Frameworks/Security.framework/Security", {
      SecStaticCodeCreateWithPath: { args: [FFIType.u64, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
      SecRequirementCreateWithString: { args: [FFIType.u64, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
      SecStaticCodeCheckValidityWithErrors: { args: [FFIType.u64, FFIType.u32, FFIType.u64, FFIType.u64], returns: FFIType.i32 },
    })
    const cString = (text: string) => Buffer.from(`${text}\0`, "utf8")
    security = {
      check(path, requirement) {
        const pathBytes = Buffer.from(path, "utf8")
        const url = BigInt(cf.symbols.CFURLCreateFromFileSystemRepresentation(0n, ptr(pathBytes), pathBytes.length, false))
        const text = BigInt(cf.symbols.CFStringCreateWithCString(0n, ptr(cString(requirement)), UTF8))
        const codeOut = new BigUint64Array(1)
        const requirementOut = new BigUint64Array(1)
        try {
          if (url === 0n || text === 0n) return false
          if (sec.symbols.SecStaticCodeCreateWithPath(url, 0, ptr(codeOut)) !== 0) return false
          if (sec.symbols.SecRequirementCreateWithString(text, 0, ptr(requirementOut)) !== 0) return false
          const code = codeOut[0] ?? 0n
          const designated = requirementOut[0] ?? 0n
          return sec.symbols.SecStaticCodeCheckValidityWithErrors(code, STRICT_ALL_ARCHITECTURES, designated, 0n) === 0
        } finally {
          for (const ref of [url, text, codeOut[0] ?? 0n, requirementOut[0] ?? 0n]) if (ref !== 0n) cf.symbols.CFRelease(ref)
        }
      },
    }
  } catch {
    security = null
  }
  return security
}

export async function signatureBackend(): Promise<"ffi" | "codesign"> {
  return (await loadSecurity()) === null ? "codesign" : "ffi"
}

async function verifyWithCodesign(path: string, requirement: string): Promise<boolean> {
  const child = Bun.spawn(["/usr/bin/codesign", "--verify", "--strict", `-R=${requirement}`, path], {
    stdout: "ignore",
    stderr: "ignore",
    env: {},
  })
  return (await child.exited) === 0
}

/** bun:ffi first, `/usr/bin/codesign --verify --strict -R=<DR>` when the framework cannot be loaded. */
export const verifyWithSecurityFramework: RequirementCheck = async (path, requirement) => {
  const loaded = await loadSecurity()
  return loaded === null ? verifyWithCodesign(path, requirement) : loaded.check(path, requirement)
}

async function fileIdentity(path: string): Promise<string | null> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return null
    return `${path}\0${info.dev}\0${info.ino}\0${info.size}\0${info.mtimeMs}\0${info.ctimeMs}`
  } catch {
    return null
  }
}

/**
 * One verdict per file identity (dev, inode, size, mtime, ctime) per process (design 1, "Checking the helper"): a
 * replaced or rewritten file is checked again, an unchanged one is not. ctime moves on every write and cannot be set
 * back with utimes. The file is stat'ed before AND after the check, and a verdict is stored only when both agree, so it
 * is never recorded under the identity of a file that changed while it was being checked (that answers "invalid").
 */
export type SignatureChecker = ((path: string) => Promise<SignatureVerdict>) & {
  /** Whether a verdict for the file as it is now is already cached. */
  readonly knows: (path: string) => Promise<boolean>
}

export function createSignatureChecker(check: RequirementCheck = verifyWithSecurityFramework, requirement = KEYCHAIN_HELPER_REQUIREMENT): SignatureChecker {
  const verdicts = new Map<string, SignatureVerdict>()
  const checker = async (path: string): Promise<SignatureVerdict> => {
    const before = await fileIdentity(path)
    if (before === null) return "missing"
    const known = verdicts.get(before)
    if (known !== undefined) return known
    const passed = await check(path, requirement)
    if ((await fileIdentity(path)) !== before) return "invalid"
    const verdict: SignatureVerdict = passed ? "valid" : "invalid"
    verdicts.set(before, verdict)
    return verdict
  }
  return Object.assign(checker, {
    knows: async (path: string) => {
      const identity = await fileIdentity(path)
      return identity !== null && verdicts.has(identity)
    },
  })
}

let processChecker: SignatureChecker | undefined
/** The one checker of this process: its verdict cache is shared by every resolution and every spawn. */
export const processSignatureChecker = (): SignatureChecker => (processChecker ??= createSignatureChecker())
