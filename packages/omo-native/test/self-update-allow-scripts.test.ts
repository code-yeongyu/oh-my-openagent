import { describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { channelPackageSpec } from "../bin/lib/package-paths.js"
import { classifyAllowScriptsNotice, formatAllowScriptsGuidance, parseAllowScriptsNotice, runSelfUpdate } from "../bin/lib/self-update.js"

const SPEC = channelPackageSpec()
const offline = { fetchDistTags: () => null }
const npmUpdate = (spec = SPEC) => ({ manager: "npm", command: `npm i -g ${spec}`, argv: ["npm", "i", "-g", spec] })

// The headline npm prints before "covered by allowScripts:", captured from real npm 11 and npm 12 sources.
const HEADLINES: Record<string, string> = {
  "11": "have install scripts not yet",
  "12": "had install scripts blocked because they are not",
}
function noticeLog(npm: string, packages: string[]): string {
  return [
    `40 warn install-scripts ${packages.length} packages ${HEADLINES[npm]} covered by allowScripts:`,
    ...packages.map((pkg) => `40 warn install-scripts   ${pkg} (postinstall: node install.js)`),
  ].join("\n")
}
const decide = (npm: string, packages: string[]) => classifyAllowScriptsNotice(parseAllowScriptsNotice(noticeLog(npm, packages))!)

// The fake behaves like npm 11+: it never runs an install script unless --allow-scripts is passed, and like
// real npm it writes to its debug log in `<logs-dir>/<id>-debug-0.log` (`<n> warn install-scripts <line>`,
// checked against npm 11.21.0 and 12.2.0) while stdout and stderr stay on the inherited terminal. With
// FAKE_NPM_FAIL it fails the way npm 12 does: an error line pointing at that log, then exit 1.
const FAKE_NPM = `#!/bin/sh
echo "$@" >> "$FAKE_NPM_DIR/argv"
env | grep '^npm_config_logs_dir=' > "$FAKE_NPM_DIR/logs-dir"
log="$npm_config_logs_dir/2026-10-06T10_00_00_000Z-debug-0.log"
echo "0 verbose cli /usr/bin/node /usr/bin/npm" >> "$log"
if [ -n "$FAKE_NPM_FAIL" ]; then
  echo "npm error A complete log of this run can be found in: $log" >&2
  exit 1
fi
if [ -n "$FAKE_NPM_PACKAGES" ]; then
  echo "$FAKE_NPM_NOTICE" >> "$log"
fi
exit 0
`

async function updateWithFakeNpm(options: { packages?: string[]; spec?: string; npm?: string; fail?: boolean } = {}) {
  const { packages = [], spec = SPEC, npm = "11", fail = false } = options
  const dir = mkdtempSync(join(tmpdir(), "omo-fake-npm-"))
  writeFileSync(join(dir, "npm"), FAKE_NPM)
  chmodSync(join(dir, "npm"), 0o755)
  const lines: string[] = []
  const errors: string[] = []
  const code = await runSelfUpdate(["update"], {
    resolveUpdate: () => npmUpdate(spec),
    ...offline,
    env: {
      ...process.env,
      PATH: `${dir}${delimiter}${process.env.PATH}`,
      FAKE_NPM_DIR: dir,
      FAKE_NPM_PACKAGES: packages.join(","),
      FAKE_NPM_NOTICE: packages.length ? noticeLog(npm, packages) : "",
      ...(fail ? { FAKE_NPM_FAIL: "1" } : {}),
    },
    readInstalled: () => ({ omo: "1.0.0", engine: "1" }),
    log: (line) => lines.push(line),
    error: (line) => errors.push(line),
  })
  const argv = readFileSync(join(dir, "argv"), "utf8").trim().split("\n")
  const logsDir = readFileSync(join(dir, "logs-dir"), "utf8").trim().replace("npm_config_logs_dir=", "")
  const logsDirKept = existsSync(logsDir)
  const keptLogs = logsDirKept ? readFileSync(join(logsDir, "2026-10-06T10_00_00_000Z-debug-0.log"), "utf8") : ""
  rmSync(dir, { recursive: true, force: true })
  rmSync(logsDir, { recursive: true, force: true })
  return { code, lines, errors, argv, logsDir, logsDirKept, keptLogs }
}

// An injected `run` that records the options it got, for the cases that need no fake shell script.
async function updateWithRun(run: (options: Record<string, any>) => Promise<unknown>) {
  const lines: string[] = []
  const code = await runSelfUpdate(["update"], {
    resolveUpdate: () => npmUpdate(),
    ...offline,
    readInstalled: () => ({ omo: "1.0.0", engine: "1" }),
    run: async (_command, _args, options = {}) => run(options) as Promise<{ status: number | null; signal: string | null }>,
    log: (line) => lines.push(line),
    error: () => {},
  })
  return { code, lines }
}

// The fakes are #!/bin/sh scripts and use POSIX permissions, so these run where those work.
const posixOnly = test.skipIf(process.platform === "win32")
const KNOWN = ["@google/genai@2.25.0", "esbuild@0.28.2", "protobufjs@7.6.6", "omo-ai@5.1.28"]

describe("omo update allowScripts notice", () => {
  describe("#given the packages npm reported", () => {
    test("#then omo-ai and the three build-tool packages are known, on both npm versions", () => {
      for (const npm of ["11", "12"]) {
        expect(decide(npm, KNOWN)).toEqual({ blocked: npm === "12", known: ["@google/genai", "esbuild", "protobufjs", "omo-ai"], other: [] })
      }
    })

    test("#then an unknown package is named as unreviewed and no package is vouched for", () => {
      expect(decide("12", ["left-pad@1.3.0"])).toEqual({ blocked: true, known: [], other: ["left-pad"] })
    })

    test("#then a mix splits known from unknown", () => {
      expect(decide("11", ["esbuild@0.28.2", "@scope/native@1.0.0", "protobufjs@7.6.6"])).toEqual({
        blocked: false,
        known: ["esbuild", "protobufjs"],
        other: ["@scope/native"],
      })
    })

    test("#then the parser reads the stderr form of the lines and ignores a log without the notice", () => {
      const notice = parseAllowScriptsNotice([
        "npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:",
        "npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)",
        "npm warn install-scripts   @google/genai@2.25.0 (preinstall: echo 'x')",
      ].join("\n"))
      expect(notice).toEqual({ blocked: false, packages: ["esbuild", "@google/genai"] })
      expect(parseAllowScriptsNotice("0 verbose cli\n41 info ok")).toBeNull()
    })

    test("#then a header with no package lines prints nothing", () => {
      const header = "40 warn install-scripts 2 packages had install scripts blocked because they are not covered by allowScripts:"
      const notice = parseAllowScriptsNotice(header)
      expect(notice).toEqual({ blocked: true, packages: [] })
      expect(formatAllowScriptsGuidance(npmUpdate(), notice!)).toEqual([])
    })
  })

  describe("#given a fake npm on PATH that records its argv", () => {
    for (const npm of ["11", "12"]) {
      posixOnly(`#then an npm ${npm} update never passes --allow-scripts`, async () => {
        const { code, lines, errors, argv } = await updateWithFakeNpm({ packages: KNOWN, spec: "omo-ai@5.1.6", npm })
        expect(code).toBe(0)
        expect(errors).toEqual([])
        expect(argv).toEqual(["i -g omo-ai@5.1.6"])
        expect(lines.join("\n")).not.toContain("--allow-scripts")
      })
    }

    posixOnly("#then only the unknown package is left out of the safety line", async () => {
      const { lines } = await updateWithFakeNpm({ packages: ["esbuild@0.28.2", "left-pad@1.3.0"], npm: "12" })
      const unreviewed = lines.filter((line) => line.includes("left-pad"))
      expect(unreviewed).toHaveLength(1)
      expect(unreviewed[0]).not.toContain("esbuild")
      expect(lines.filter((line) => line.includes("esbuild"))).toHaveLength(1)
    })

    posixOnly("#then an npm without the notice prints no guidance", async () => {
      const { code, lines, argv } = await updateWithFakeNpm()
      expect(code).toBe(0)
      expect(argv).toEqual([`i -g ${SPEC}`])
      expect(lines.some((line) => line.startsWith("omo: npm") || line.includes("reinstall use"))).toBe(false)
    })

    posixOnly("#then the npm log directory is a fresh temp dir that is removed after a successful install", async () => {
      const { logsDir, logsDirKept } = await updateWithFakeNpm()
      expect(logsDir.startsWith(join(tmpdir(), "omo-npm-logs-"))).toBe(true)
      expect(logsDirKept).toBe(false)
    })

    posixOnly("#then a failed install keeps the log directory npm pointed the user to", async () => {
      const { code, errors, logsDir, logsDirKept, keptLogs } = await updateWithFakeNpm({ fail: true })
      expect(code).toBe(1)
      expect(errors).toEqual([`omo: update failed; retry with: npm i -g ${SPEC}`])
      expect(logsDirKept).toBe(true)
      expect(keptLogs).toContain("0 verbose cli")
      expect(logsDir.startsWith(join(tmpdir(), "omo-npm-logs-"))).toBe(true)
    })
  })

  describe("#given the log directory cannot be managed", () => {
    posixOnly("#then an unusable TMPDIR runs npm without a logs dir and still succeeds", async () => {
      const saved = process.env.TMPDIR
      process.env.TMPDIR = join(tmpdir(), "omo-no-such-tmp", "nested")
      try {
        let env: Record<string, string> = {}
        const { code, lines } = await updateWithRun(async (options) => {
          env = options.env
          return { status: 0, signal: null }
        })
        expect(code).toBe(0)
        expect(env).not.toHaveProperty("npm_config_logs_dir")
        expect(lines.some((line) => line.startsWith("omo: npm"))).toBe(false)
      } finally {
        if (saved === undefined) delete process.env.TMPDIR
        else process.env.TMPDIR = saved
      }
    })

    test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("#then a cleanup failure does not change a successful exit", async () => {
      let logsDir = ""
      const { code } = await updateWithRun(async (options) => {
        logsDir = options.env.npm_config_logs_dir
        mkdirSync(join(logsDir, "sub"))
        writeFileSync(join(logsDir, "sub", "file"), "x")
        chmodSync(join(logsDir, "sub"), 0o500) // rmSync cannot unlink inside a read-only directory
        return { status: 0, signal: null }
      })
      chmodSync(join(logsDir, "sub"), 0o700)
      rmSync(logsDir, { recursive: true, force: true })
      expect(code).toBe(0)
    })

    test("#then a signal-killed npm leaves no log directory behind", async () => {
      let logsDir = ""
      const { code } = await updateWithRun(async (options) => {
        logsDir = options.env.npm_config_logs_dir
        return { status: null, signal: "SIGTERM" }
      })
      expect(code).toBe(1)
      expect(existsSync(logsDir)).toBe(false)
    })

    test("#then the directory is also released before the process re-raises a signal on itself", async () => {
      let logsDir = ""
      let release: (() => void) | undefined
      await updateWithRun(async (options) => {
        logsDir = options.env.npm_config_logs_dir
        release = options.onBeforeSignalExit
        return { status: 0, signal: null }
      })
      mkdirSync(logsDir)
      release?.()
      expect(existsSync(logsDir)).toBe(false)
    })
  })

  describe("#given the update is run", () => {
    test("#then the npm child keeps inherited stdio so npm still sees the terminal", async () => {
      let stdio: unknown
      await updateWithRun(async (options) => {
        stdio = options.stdio
        return { status: 0, signal: null }
      })
      expect(stdio).toBe("inherit")
    })

    test("#then a bun update creates no npm log dir and prints no npm guidance", async () => {
      let env: Record<string, string> = {}
      const lines: string[] = []
      await runSelfUpdate(["update"], {
        resolveUpdate: () => ({ manager: "bun", command: `bun add -g ${SPEC}`, argv: ["bun", "add", "-g", SPEC] }),
        ...offline,
        readInstalled: () => ({ omo: "1.0.0", engine: "1" }),
        run: async (_command, _args, options = {}) => {
          env = options.env as Record<string, string>
          return { status: 0, signal: null }
        },
        log: (line) => lines.push(line),
      })
      expect(env.npm_config_logs_dir).toBeUndefined()
      expect(lines.some((line) => line.startsWith("omo: npm"))).toBe(false)
    })
  })
})
