import { describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { channelPackageSpec, releaseChannel, updateTarget } from "../bin/lib/package-paths.js"

// updateTarget reads the version of the install it is pointed at and falls back to this package's own
// manifest, so the expected spelling follows the package channel (`omo-ai` stable, `omo-ai@beta` prerelease).
const SPEC = channelPackageSpec()
import {
  formatUpdateCommand,
  formatVersionChange,
  isPrintOnlyUpdate,
  runSelfUpdate,
} from "../bin/lib/self-update.js"

// These cases cover the spawn mechanics on the registry-unreachable path, which keeps the unpinned
// channel spec; the pinned path lives in self-update-pinned-target.test.ts.
const offline = { fetchDistTags: () => null }
function unconfirmedNotice(version: string): string {
  return `omo: could not confirm the ${releaseChannel(version)} omo-ai version from the npm registry; installing the unpinned ${channelPackageSpec(version)}`
}

function bunRoot(path: string): string {
  return path.replace(/\\/g, "/")
}

describe("updateTarget", () => {
  describe("#given a Bun global install layout", () => {
    test("#then the command is bun add -g and BUN_INSTALL is the prefix, not a --cwd into the package", () => {
      const root = bunRoot("/tmp/custom-bun/install/global/node_modules/omo-ai")
      expect(updateTarget(root)).toEqual({
        manager: "bun",
        command: `bun add -g ${SPEC}`,
        argv: ["bun", "add", "-g", SPEC],
        env: { BUN_INSTALL: "/tmp/custom-bun" },
      })
    })

    test("#then a Windows-style Bun path still yields bun add -g with BUN_INSTALL at the bun root", () => {
      const root = String.raw`C:\Users\omo user\.bun\install\global\node_modules\omo-ai`
      expect(updateTarget(root, "win32")).toEqual({
        manager: "bun",
        command: `bun add -g ${SPEC}`,
        argv: ["bun", "add", "-g", SPEC],
        env: { BUN_INSTALL: "C:/Users/omo user/.bun" },
      })
    })

    test("#then a path with shell metacharacters is carried in BUN_INSTALL, not quoted into the command", () => {
      const root = "/tmp/custom $HOME's bun/install/global/node_modules/omo-ai"
      const target = updateTarget(root)
      expect(target.command).toBe(`bun add -g ${SPEC}`)
      expect(target.env).toEqual({ BUN_INSTALL: "/tmp/custom $HOME's bun" })
    })
  })

  describe("#given an npm or unknown layout", () => {
    test("#then the command stays npm i -g with npm argv and no BUN_INSTALL overlay", () => {
      expect(updateTarget("/tmp/prefix/lib/node_modules/omo-ai")).toEqual({
        manager: "npm",
        command: `npm i -g ${SPEC}`,
        argv: ["npm", "i", "-g", SPEC],
      })
    })

  })
})

describe("omo self-update", () => {
  describe("#given a resolved update target", () => {
    const bunUpdate = {
      manager: "bun",
      command: `bun add -g ${SPEC}`,
      argv: ["bun", "add", "-g", SPEC],
      env: { BUN_INSTALL: "/tmp/custom-bun" },
    }
    const npmUpdate = {
      manager: "npm",
      command: `npm i -g ${SPEC}`,
      argv: ["npm", "i", "-g", SPEC],
    }

    describe("#when --dry-run or --print is requested", () => {
      for (const args of [["update", "--dry-run"], ["update", "--print"], ["update", "--self", "--dry-run"]]) {
        test(`#then ${args.join(" ")} prints the command and does not spawn`, async () => {
          const spawned: unknown[] = []
          const lines: string[] = []
          const code = await runSelfUpdate(args, {
            resolveUpdate: () => bunUpdate,
            ...offline,
            readInstalled: () => ({ omo: "5.0.0", engine: "2026.9.29" }),
            run: async (...call: unknown[]) => {
              spawned.push(call)
              return { status: 0, signal: null }
            },
            log: (line) => lines.push(line),
            error: (line) => lines.push(`err:${line}`),
          })
          expect(isPrintOnlyUpdate(args)).toBe(true)
          expect(code).toBe(0)
          expect(spawned).toEqual([])
          expect(lines).toEqual([unconfirmedNotice("5.0.0"), formatUpdateCommand(bunUpdate)])
        })
      }
    })

    describe("#when omo update runs", () => {
      test("#then it spawns the resolved argv, overlays BUN_INSTALL, and prints before/after versions", async () => {
        const spawned: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = []
        const lines: string[] = []
        let reads = 0
        const code = await runSelfUpdate(["update"], {
          resolveUpdate: () => bunUpdate,
            ...offline,
          env: { PATH: "/usr/bin", BUN_INSTALL: "/wrong" },
          readInstalled: () => {
            reads += 1
            return reads === 1
              ? { omo: "5.0.0-0.beta.88", engine: "2026.9.1" }
              : { omo: "5.0.0-0.beta.89", engine: "2026.9.24" }
          },
          run: async (command, args, options = {}) => {
            spawned.push({ command, args, env: options.env ?? {} })
            return { status: 0, signal: null }
          },
          log: (line) => lines.push(line),
          error: (line) => lines.push(`err:${line}`),
        })
        expect(code).toBe(0)
        expect(spawned).toEqual([{
          command: "bun",
          args: ["add", "-g", SPEC],
          env: { PATH: "/usr/bin", BUN_INSTALL: "/tmp/custom-bun" },
        }])
        expect(lines).toEqual([
          unconfirmedNotice("5.0.0-0.beta.88"),
          `omo is updated via bun: bun add -g ${SPEC}`,
          "omo 5.0.0-0.beta.88 -> 5.0.0-0.beta.89 (engine: senpi 2026.9.24)",
        ])
        expect(formatVersionChange(
          { omo: "5.0.0-0.beta.88", engine: "2026.9.1" },
          { omo: "5.0.0-0.beta.89", engine: "2026.9.24" },
        )).toBe("omo 5.0.0-0.beta.88 -> 5.0.0-0.beta.89 (engine: senpi 2026.9.24)")
      })

      test("#then an npm-managed install spawns npm i -g without a BUN_INSTALL overlay", async () => {
        const spawned: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = []
        const code = await runSelfUpdate(["update"], {
          resolveUpdate: () => npmUpdate,
            ...offline,
          env: { PATH: "/usr/bin" },
          readInstalled: () => ({ omo: "1.0.0", engine: "1" }),
          run: async (command, args, options = {}) => {
            spawned.push({ command, args, env: options.env ?? {} })
            return { status: 0, signal: null }
          },
          log: () => {},
        })
        expect(code).toBe(0)
        expect(spawned).toEqual([{
          command: "npm",
          args: ["i", "-g", SPEC],
          env: { PATH: "/usr/bin" },
        }])
      })
    })

    describe("#when the package manager fails", () => {
      test("#then a non-zero status exits non-zero with the manual command and skips the version line", async () => {
        const lines: string[] = []
        const errors: string[] = []
        const code = await runSelfUpdate(["update"], {
          resolveUpdate: () => bunUpdate,
            ...offline,
          readInstalled: () => ({ omo: "5.0.0-0.beta.88", engine: "x" }),
          run: async () => ({ status: 7, signal: null }),
          log: (line) => lines.push(line),
          error: (line) => errors.push(line),
        })
        expect(code).toBe(7)
        expect(lines).toEqual([unconfirmedNotice("5.0.0-0.beta.88"), `omo is updated via bun: bun add -g ${SPEC}`])
        expect(errors).toEqual([`omo: update failed; retry with: bun add -g ${SPEC}`])
      })

      test("#then a spawn error exits 1 with the same retry command", async () => {
        const errors: string[] = []
        const code = await runSelfUpdate(["update"], {
          resolveUpdate: () => npmUpdate,
            ...offline,
          readInstalled: () => ({ omo: "1.0.0", engine: "1" }),
          run: async () => {
            throw new Error("ENOENT")
          },
          log: () => {},
          error: (line) => errors.push(line),
        })
        expect(code).toBe(1)
        expect(errors).toEqual([`omo: update failed; retry with: npm i -g ${SPEC}`])
      })
    })
  })

  describe("#given a fake npm on PATH that records its argv", () => {
    // The fake behaves like npm 11+: whenever an allow flag would let one of the three install scripts
    // run it writes a marker, and it ends with npm's allowScripts notice unless that flag was given.
    const FAKE_NPM = `#!/bin/sh
echo "$@" >> "$FAKE_NPM_DIR/argv"
case "$*" in
  *--allow-scripts*) echo ran > "$FAKE_NPM_DIR/marker" ;;
  *) if [ "$FAKE_NPM_NOTICE" = 1 ]; then
       echo "npm warn install-scripts 3 packages $FAKE_NPM_HEADLINE covered by allowScripts:" >&2
       echo "npm warn install-scripts   @google/genai@2.25.0 (preinstall: echo 'preinstall: no-op')" >&2
       echo "npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)" >&2
       echo "npm warn install-scripts   protobufjs@7.6.6 (postinstall: node scripts/postinstall)" >&2
       echo "npm warn install-scripts" >&2
       echo "npm warn install-scripts Run npm install -g --allow-scripts=@google/genai,esbuild,protobufjs to allow these scripts once" >&2
     fi ;;
esac
exit 0
`

    // The headline npm prints before "covered by allowScripts:", captured from real npm 11 and npm 12 output.
    const HEADLINES: Record<string, string> = {
      "11": "have install scripts not yet",
      "12": "had install scripts blocked because they are not",
    }

    async function updateWithFakeNpm(notice: boolean, spec = SPEC, npm = "11") {
      const dir = mkdtempSync(join(tmpdir(), "omo-fake-npm-"))
      const npmPath = join(dir, "npm")
      writeFileSync(npmPath, FAKE_NPM)
      chmodSync(npmPath, 0o755)
      const lines: string[] = []
      const errors: string[] = []
      const code = await runSelfUpdate(["update"], {
        resolveUpdate: () => ({ manager: "npm", command: `npm i -g ${spec}`, argv: ["npm", "i", "-g", spec] }),
        ...offline,
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_NPM_DIR: dir, FAKE_NPM_NOTICE: notice ? "1" : "0", FAKE_NPM_HEADLINE: HEADLINES[npm] },
        readInstalled: () => ({ omo: "1.0.0", engine: "1" }),
        log: (line) => lines.push(line),
        error: (line) => errors.push(line),
      })
      const argv = readFileSync(join(dir, "argv"), "utf8").trim().split("\n")
      const marker = existsSync(join(dir, "marker"))
      rmSync(dir, { recursive: true, force: true })
      return { code, lines, errors, argv, marker }
    }

    // npm 11 only notices and npm 12 blocks; omo's argv and guidance are the same for both.
    for (const npm of ["11", "12"]) {
      test(`#then an npm ${npm} update never passes --allow-scripts, runs no install script, and prints a working retry command`, async () => {
        const { code, lines, errors, argv, marker } = await updateWithFakeNpm(true, "omo-ai@5.1.6", npm)
        expect(code).toBe(0)
        expect(errors).toEqual([])
        expect(argv).toEqual(["i -g omo-ai@5.1.6"])
        expect(marker).toBe(false)
        const guidance = lines.filter((line) => line.startsWith("omo: npm skipped") || line.startsWith("omo: if npm suggested"))
        expect(guidance[0]).toContain("esbuild, @google/genai, protobufjs")
        expect(guidance[0]).toContain("skipping them is safe, omo runs without them")
        expect(lines.join("\n")).not.toContain("--allow-scripts")
        const printed = guidance[1].slice(guidance[1].lastIndexOf("use: ") + "use: ".length)
        expect(printed.split(" ").slice(0, 3)).toEqual(["npm", "i", "-g"])
        expect(printed.split(" ")[3]).toBe("omo-ai@5.1.6")
      })
    }

    test("#then an npm without the notice prints no guidance and passes the plain argv", async () => {
      const { code, lines, argv, marker } = await updateWithFakeNpm(false)
      expect(code).toBe(0)
      expect(argv).toEqual([`i -g ${SPEC}`])
      expect(marker).toBe(false)
      expect(lines.some((line) => line.includes("skipping them is safe"))).toBe(false)
    })

    test("#then a bun update does not observe output or print the npm guidance", async () => {
      const runOptions: Array<Record<string, unknown>> = []
      const lines: string[] = []
      await runSelfUpdate(["update"], {
        resolveUpdate: () => ({ manager: "bun", command: `bun add -g ${SPEC}`, argv: ["bun", "add", "-g", SPEC] }),
        ...offline,
        readInstalled: () => ({ omo: "1.0.0", engine: "1" }),
        run: async (_command, _args, options = {}) => {
          runOptions.push(options)
          return { status: 0, signal: null }
        },
        log: (line) => lines.push(line),
      })
      expect(runOptions[0]).not.toHaveProperty("onOutput")
      expect(lines.some((line) => line.includes("skipping them is safe"))).toBe(false)
    })
  })
})
