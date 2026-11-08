import { chmodSync, realpathSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { locateDesktopEngine } from "@oh-my-opencode/senpi-desktop-engine"
import { workDir } from "./fixtures"
import { type RunOptions, type ScenarioResult, toolError, withSession } from "./scenario"

const DISCLAIM_PY = `import ctypes, os, sys
libc = ctypes.CDLL(None, use_errno=True)
attr = ctypes.c_void_p()
assert libc.posix_spawnattr_init(ctypes.byref(attr)) == 0
assert libc.responsibility_spawnattrs_setdisclaim(ctypes.byref(attr), 1) == 0
argv = (ctypes.c_char_p * len(sys.argv))(*[a.encode() for a in sys.argv[1:]], None)
env = (ctypes.c_char_p * (len(os.environ) + 1))(*[f"{k}={v}".encode() for k, v in os.environ.items()], None)
pid = ctypes.c_int()
assert libc.posix_spawn(ctypes.byref(pid), sys.argv[1].encode(), None, ctypes.byref(attr), argv, env) == 0
sys.exit(os.waitstatus_to_exitcode(os.waitpid(pid.value, 0)[1]))
`

/** The QA wrapper gives the engine its own TCC responsibility instead of the Terminal grant. */
export async function tccDiagnostic(options: RunOptions): Promise<ScenarioResult> {
  const location = locateDesktopEngine()
  const engine = options.enginePath ?? location.path
  if (engine === null || engine === undefined) throw new Error(location.diagnostic?.message ?? "engine unavailable")
  const helper = join(workDir, "disclaim.py")
  const wrapper = join(workDir, "disclaimed-engine.sh")
  writeFileSync(helper, DISCLAIM_PY)
  writeFileSync(wrapper, `#!/bin/sh\nexec /usr/bin/python3 '${helper}' '${engine}' "$@"\n`)
  chmodSync(wrapper, 0o755)
  return withSession({ ...options, enginePath: wrapper }, {}, async (session) => {
    const result = await session.call({ action: "call", chain: [{ method: "screenshot" }] })
    const message = toolError(result) ?? ""
    const { pass, identity } = tccIdentityPasses(message, engine)
    return { scenario: "tcc-diagnostic", pass: result.isError && pass,
      facts: { launcher: "engine spawned with TCC responsibility disclaimed", engine, message, identity } }
  })
}

/** The denial must name the engine itself as the TCC responsible process (#9345's message form). */
export function tccIdentityPasses(message: string, engine: string): { pass: boolean; identity: string | null } {
  const identity = /TCC identity: responsible=(.+?)(?: bundle=[^,)]+)?, pid=\d+\)/.exec(message)?.[1] ?? null
  return { pass: identity !== null && canonical(identity) === canonical(engine), identity }
}

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}
