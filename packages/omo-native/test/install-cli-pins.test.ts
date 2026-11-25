import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { answerCompiledFastPath, runCompiledLauncher } from "../compile-entry"
import { compiledUpdate, releaseAssetName } from "../compiled-update"

// Slice C1c (#14960) pins: the text, stream and exit code of `omo setup`, `omo update` and
// `omo --version` / `-v` in both editions, written against the code before the install calls move
// onto the SDK root. These stay unmodified through the move: the adapters must keep every byte.
// Nothing here downloads or replaces a real binary: the registry, the release list, the package
// manager and the binary install are fakes.

const SOURCE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const TTY_DRIVER = resolve(fileURLToPath(new URL("tty-driver.py", import.meta.url)))
const CANARY = "SK-C1C-CANARY-DO-NOT-PRINT"
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  roots.push(root)
  return root
}

function hermeticEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  return {
    PATH: "/usr/bin:/bin",
    ...Object.fromEntries(
      ["TMPDIR", "SystemRoot", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP"].flatMap((key) =>
        process.env[key] === undefined ? [] : [[key, process.env[key]]],
      ),
    ),
    ...extra,
  }
}

type Outcome = { status: number | null; stdout: string; stderr: string }

function outcome(result: ReturnType<typeof spawnSync>, root: string): Outcome {
  if (result.error) throw result.error
  const clean = (text: unknown) =>
    String(text)
      .replaceAll("\r\n", "\n")
      .replaceAll("\r", "")
      .replaceAll(/\x1B\[[0-9;]*[A-Za-z]/g, "")
      .replaceAll(/(\[(?:y\/N|Y\/n)\])(?:[ \t]*[yn]?[ \t]*\n)+/g, "$1 <answered>\n")
      .replaceAll(root, "<ROOT>")
  return { status: result.status, stdout: clean(result.stdout), stderr: clean(result.stderr) }
}

type UpdateFixture = { root: string; launcher: string; captureFile: string; packageJson: string }

function updateFixture(): UpdateFixture {
  const root = tempRoot("omo-c1c-update-")
  const packageRoot = join(root, "prefix", "lib", "node_modules", "omo-ai")
  cpSync(join(SOURCE_ROOT, "bin"), join(packageRoot, "bin"), { recursive: true })
  const packageJson = join(packageRoot, "package.json")
  writeFile(
    packageJson,
    JSON.stringify({
      name: "omo-ai",
      version: "1.2.3",
      type: "module",
      dependencies: { "@code-yeongyu/senpi": "2026.8.9" },
    }),
  )
  const senpiRoot = join(packageRoot, "node_modules", "@code-yeongyu", "senpi")
  writeFile(
    join(senpiRoot, "package.json"),
    JSON.stringify({
      name: "@code-yeongyu/senpi",
      version: "2026.8.9",
      type: "module",
      exports: { ".": "./dist/index.js" },
    }),
  )
  writeFile(join(senpiRoot, "dist", "index.js"), "export const fixture = true\n")
  writeFile(join(senpiRoot, "dist", "core", "brand.js"), "export {}\n")
  writeFile(
    join(senpiRoot, "dist", "cli.js"),
    `import { appendFileSync } from "node:fs"
appendFileSync(process.env.CAPTURE_FILE, JSON.stringify({ target: "engine", argv: process.argv.slice(2) }) + "\\n")
`,
  )
  // The registry answers what the test sets; "null" is a registry that cannot be reached.
  writeFile(
    join(packageRoot, "bin", "lib", "npm-dist-tags.js"),
    `export function fetchNpmDistTagsSync() {
  return JSON.parse(process.env.FAKE_DIST_TAGS ?? "null")
}
`,
  )
  // The package manager records its argv; FAKE_INSTALL decides whether the install moves the version.
  writeFile(
    join(packageRoot, "bin", "lib", "child-process.js"),
    `import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
export function propagateResult() {}
export async function spawnNode(cliPath, args) {
  appendFileSync(process.env.CAPTURE_FILE, JSON.stringify({ target: "engine", argv: args }) + "\\n")
}
export async function runChild(command, args) {
  appendFileSync(process.env.CAPTURE_FILE, JSON.stringify({ target: "install", command, args }) + "\\n")
  if (process.env.FAKE_INSTALL === "fail") return { status: 3, signal: null }
  if (process.env.FAKE_INSTALL === "moves") {
    const version = /@([^@]+)$/.exec(args.at(-1))?.[1]
    const manifest = JSON.parse(readFileSync(process.env.FAKE_PACKAGE_JSON, "utf8"))
    writeFileSync(process.env.FAKE_PACKAGE_JSON, JSON.stringify({ ...manifest, version }))
  }
  return { status: 0, signal: null }
}
`,
  )
  return { root, launcher: join(packageRoot, "bin", "omo.js"), captureFile: join(root, "capture.jsonl"), packageJson }
}

function runUpdateFixture(
  fixture: UpdateFixture,
  args: string[],
  fakes: { distTags?: unknown; install?: "moves" | "stays" | "fail" } = {},
) {
  const env = hermeticEnv({
    HOME: join(fixture.root, "home"),
    CAPTURE_FILE: fixture.captureFile,
    FAKE_DIST_TAGS: JSON.stringify(fakes.distTags ?? null),
    FAKE_INSTALL: fakes.install ?? "moves",
    FAKE_PACKAGE_JSON: fixture.packageJson,
  })
  const result = outcome(
    spawnSync(process.execPath, [fixture.launcher, ...args], { encoding: "utf8", env }),
    fixture.root,
  )
  const calls = existsSync(fixture.captureFile)
    ? readFileSync(fixture.captureFile, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as unknown)
    : []
  return { ...result, calls }
}

const NEWER = { latest: "1.2.4" }

describe("C1c pins: omo update, npm edition", () => {
  const npmUpdates = (spellings: string[][]) =>
    Object.fromEntries(
      spellings.map((args) => [args.join(" "), runUpdateFixture(updateFixture(), args, { distTags: NEWER })]),
    )

  test("#given each install spelling and a newer release #then each installs the pinned version once and reports the move", () => {
    expect(npmUpdates([["update"], ["update", "--self"], ["update", "self"], ["update", "senpi"], ["update", "omo"]]))
      .toMatchInlineSnapshot(`
      {
        "update": {
          "calls": [
            {
              "args": [
                "i",
                "-g",
                "omo-ai@1.2.4",
              ],
              "command": "npm",
              "target": "install",
            },
          ],
          "status": 0,
          "stderr": "",
          "stdout": 
      "omo is updated via npm: npm i -g omo-ai@1.2.4
      omo 1.2.3 -> 1.2.4 (engine: senpi 2026.8.9)
      "
      ,
        },
        "update --self": {
          "calls": [
            {
              "args": [
                "i",
                "-g",
                "omo-ai@1.2.4",
              ],
              "command": "npm",
              "target": "install",
            },
          ],
          "status": 0,
          "stderr": "",
          "stdout": 
      "omo is updated via npm: npm i -g omo-ai@1.2.4
      omo 1.2.3 -> 1.2.4 (engine: senpi 2026.8.9)
      "
      ,
        },
        "update omo": {
          "calls": [
            {
              "args": [
                "i",
                "-g",
                "omo-ai@1.2.4",
              ],
              "command": "npm",
              "target": "install",
            },
          ],
          "status": 0,
          "stderr": "",
          "stdout": 
      "omo is updated via npm: npm i -g omo-ai@1.2.4
      omo 1.2.3 -> 1.2.4 (engine: senpi 2026.8.9)
      "
      ,
        },
        "update self": {
          "calls": [
            {
              "args": [
                "i",
                "-g",
                "omo-ai@1.2.4",
              ],
              "command": "npm",
              "target": "install",
            },
          ],
          "status": 0,
          "stderr": "",
          "stdout": 
      "omo is updated via npm: npm i -g omo-ai@1.2.4
      omo 1.2.3 -> 1.2.4 (engine: senpi 2026.8.9)
      "
      ,
        },
        "update senpi": {
          "calls": [
            {
              "args": [
                "i",
                "-g",
                "omo-ai@1.2.4",
              ],
              "command": "npm",
              "target": "install",
            },
          ],
          "status": 0,
          "stderr": "",
          "stdout": 
      "omo is updated via npm: npm i -g omo-ai@1.2.4
      omo 1.2.3 -> 1.2.4 (engine: senpi 2026.8.9)
      "
      ,
        },
      }
    `)
  })

  test("#given each print-only spelling #then it prints the command and installs nothing", () => {
    expect(
      npmUpdates([
        ["update", "--dry-run"],
        ["update", "--print"],
        ["update", "--self", "--dry-run"],
      ]),
    ).toMatchInlineSnapshot(`
      {
        "update --dry-run": {
          "calls": [],
          "status": 0,
          "stderr": "",
          "stdout": 
      "omo is updated via npm: npm i -g omo-ai@1.2.4
      "
      ,
        },
        "update --print": {
          "calls": [],
          "status": 0,
          "stderr": "",
          "stdout": 
      "omo is updated via npm: npm i -g omo-ai@1.2.4
      "
      ,
        },
        "update --self --dry-run": {
          "calls": [],
          "status": 0,
          "stderr": "",
          "stdout": 
      "omo is updated via npm: npm i -g omo-ai@1.2.4
      "
      ,
        },
      }
    `)
  })

  test("#given each help spelling #then it prints the usage, exits 0, looks nothing up and installs nothing", () => {
    expect(
      npmUpdates([
        ["update", "--help"],
        ["update", "-h"],
        ["update", "--dry-run", "-h"],
      ]),
    ).toMatchInlineSnapshot(`
      {
        "update --dry-run -h": {
          "calls": [],
          "status": 0,
          "stderr": "",
          "stdout": 
      "Usage: omo update [--dry-run | --print]

      Update omo to the newest release on its channel. The engine is pinned by omo and moves with it.

      Options:
        --dry-run, --print  print the update command without running it
        -h, --help          show this help
      "
      ,
        },
        "update --help": {
          "calls": [],
          "status": 0,
          "stderr": "",
          "stdout": 
      "Usage: omo update [--dry-run | --print]

      Update omo to the newest release on its channel. The engine is pinned by omo and moves with it.

      Options:
        --dry-run, --print  print the update command without running it
        -h, --help          show this help
      "
      ,
        },
        "update -h": {
          "calls": [],
          "status": 0,
          "stderr": "",
          "stdout": 
      "Usage: omo update [--dry-run | --print]

      Update omo to the newest release on its channel. The engine is pinned by omo and moves with it.

      Options:
        --dry-run, --print  print the update command without running it
        -h, --help          show this help
      "
      ,
        },
      }
    `)
  })

  test("#given each flag update does not know #then it is the usage refusal naming the flag, exit 2, nothing installed", () => {
    expect(
      npmUpdates([
        ["update", "--all"],
        ["update", "--force"],
        ["update", "--forse"],
        ["update", "-x"],
        ["update", "--dry-run", "--force"],
      ]),
    ).toMatchInlineSnapshot(`
      {
        "update --all": {
          "calls": [],
          "status": 2,
          "stderr": 
      "omo update: unknown option --all
      Run omo update --help for usage.
      "
      ,
          "stdout": "",
        },
        "update --dry-run --force": {
          "calls": [],
          "status": 2,
          "stderr": 
      "omo update: unknown option --force
      Run omo update --help for usage.
      "
      ,
          "stdout": "",
        },
        "update --force": {
          "calls": [],
          "status": 2,
          "stderr": 
      "omo update: unknown option --force
      Run omo update --help for usage.
      "
      ,
          "stdout": "",
        },
        "update --forse": {
          "calls": [],
          "status": 2,
          "stderr": 
      "omo update: unknown option --forse
      Run omo update --help for usage.
      "
      ,
          "stdout": "",
        },
        "update -x": {
          "calls": [],
          "status": 2,
          "stderr": 
      "omo update: unknown option -x
      Run omo update --help for usage.
      "
      ,
          "stdout": "",
        },
      }
    `)
  })

  test("#given the installed version is the newest #then it says so and installs nothing", () => {
    const result = runUpdateFixture(updateFixture(), ["update"], { distTags: { latest: "1.2.3" } })
    expect(result).toMatchInlineSnapshot(`
      {
        "calls": [],
        "status": 0,
        "stderr": "",
        "stdout": 
      "omo 1.2.3 is up to date (omo-ai@latest is 1.2.3)
      "
      ,
      }
    `)
  })

  test("#given an unreachable registry #then it names the unpinned spec and installs it", () => {
    const result = runUpdateFixture(updateFixture(), ["update"], { distTags: null, install: "stays" })
    expect(result).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "args": [
              "i",
              "-g",
              "omo-ai",
            ],
            "command": "npm",
            "target": "install",
          },
        ],
        "status": 0,
        "stderr": "",
        "stdout": 
      "omo: could not confirm the latest omo-ai version from the npm registry; installing the unpinned omo-ai
      omo is updated via npm: npm i -g omo-ai
      omo 1.2.3 -> 1.2.3 (engine: senpi 2026.8.9)
      "
      ,
      }
    `)
  })

  test("#given a package manager that exits 0 without moving the version #then it exits 1 with the retry command", () => {
    const result = runUpdateFixture(updateFixture(), ["update"], { distTags: NEWER, install: "stays" })
    expect(result).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "args": [
              "i",
              "-g",
              "omo-ai@1.2.4",
            ],
            "command": "npm",
            "target": "install",
          },
        ],
        "status": 1,
        "stderr": 
      "omo is still 1.2.3; 1.2.4 is published
      omo: update failed; retry with: npm i -g omo-ai@1.2.4
      "
      ,
        "stdout": 
      "omo is updated via npm: npm i -g omo-ai@1.2.4
      "
      ,
      }
    `)
  })

  test("#given a package manager that fails #then its exit code and the retry command come back", () => {
    const result = runUpdateFixture(updateFixture(), ["update"], { distTags: NEWER, install: "fail" })
    expect(result).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "args": [
              "i",
              "-g",
              "omo-ai@1.2.4",
            ],
            "command": "npm",
            "target": "install",
          },
        ],
        "status": 3,
        "stderr": 
      "omo: update failed; retry with: npm i -g omo-ai@1.2.4
      "
      ,
        "stdout": 
      "omo is updated via npm: npm i -g omo-ai@1.2.4
      "
      ,
      }
    `)
  })
})

describe("C1c pins: omo --version, npm edition", () => {
  test("#given omo --version and omo -v #then each prints the product and engine versions, exit 0, and starts nothing", () => {
    expect(
      Object.fromEntries([["--version"], ["-v"]].map((args) => [args[0], runUpdateFixture(updateFixture(), args)])),
    ).toMatchInlineSnapshot(`
      {
        "--version": {
          "calls": [],
          "status": 0,
          "stderr": "",
          "stdout": 
      "omo 1.2.3 (engine: senpi 2026.8.9)
      "
      ,
        },
        "-v": {
          "calls": [],
          "status": 0,
          "stderr": "",
          "stdout": 
      "omo 1.2.3 (engine: senpi 2026.8.9)
      "
      ,
        },
      }
    `)
  })
})

const ASSET = releaseAssetName(undefined, "linux", "x64")
const DESTINATION = "/opt/omo-release/omo"
const PROVISIONED = "/home/user/.omo/binary-runtime/9.9.9/omo"

async function compiled(
  args: string[] | undefined,
  fakes: {
    releases?: () => Promise<unknown>
    install?: "ok" | "fail"
    owner?: boolean
    destination?: string
  } = {},
) {
  const calls: unknown[] = []
  const result = await compiledUpdate({
    omoAiVersion: "9.9.9",
    releaseTarget: undefined,
    destination: fakes.destination ?? DESTINATION,
    provisioned: PROVISIONED,
    platform: "linux",
    arch: "x64",
    fetchReleases: async () => {
      calls.push("fetch-releases")
      return (fakes.releases ?? (async () => [{ tag_name: "v9.9.10", assets: [{ name: ASSET }] }]))()
    },
    probeOwner: () => (fakes.owner === true ? { manager: "dpkg", pkg: "omo" } : undefined),
    install: async (request) => {
      calls.push({ install: request })
      if (fakes.install === "fail") throw new Error(`checksum mismatch for ${request.asset}\nsecond line`)
    },
    ...(args === undefined ? {} : { args }),
  })
  return { result, calls }
}

describe("C1c pins: omo update, compiled edition", () => {
  const compiledTable = async (spellings: (string[] | undefined)[]) =>
    Object.fromEntries(
      await Promise.all(
        spellings.map(async (args) => [args?.join(" ") ?? "(no arguments)", await compiled(args)] as const),
      ),
    )

  test("#given each install spelling #then the newer release is installed over the launched binary", async () => {
    expect(
      await compiledTable([
        undefined,
        ["update"],
        ["update", "--self"],
        ["update", "self"],
        ["update", "senpi"],
        ["update", "omo"],
      ]),
    ).toMatchInlineSnapshot(`
      {
        "(no arguments)": {
          "calls": [
            "fetch-releases",
            {
              "install": {
                "asset": "omo-linux-x64",
                "destination": "/opt/omo-release/omo",
                "platform": "linux",
                "version": "9.9.10",
              },
            },
          ],
          "result": {
            "exitCode": 0,
            "output": "omo updated 9.9.9 -> 9.9.10",
          },
        },
        "update": {
          "calls": [
            "fetch-releases",
            {
              "install": {
                "asset": "omo-linux-x64",
                "destination": "/opt/omo-release/omo",
                "platform": "linux",
                "version": "9.9.10",
              },
            },
          ],
          "result": {
            "exitCode": 0,
            "output": "omo updated 9.9.9 -> 9.9.10",
          },
        },
        "update --self": {
          "calls": [
            "fetch-releases",
            {
              "install": {
                "asset": "omo-linux-x64",
                "destination": "/opt/omo-release/omo",
                "platform": "linux",
                "version": "9.9.10",
              },
            },
          ],
          "result": {
            "exitCode": 0,
            "output": "omo updated 9.9.9 -> 9.9.10",
          },
        },
        "update omo": {
          "calls": [
            "fetch-releases",
            {
              "install": {
                "asset": "omo-linux-x64",
                "destination": "/opt/omo-release/omo",
                "platform": "linux",
                "version": "9.9.10",
              },
            },
          ],
          "result": {
            "exitCode": 0,
            "output": "omo updated 9.9.9 -> 9.9.10",
          },
        },
        "update self": {
          "calls": [
            "fetch-releases",
            {
              "install": {
                "asset": "omo-linux-x64",
                "destination": "/opt/omo-release/omo",
                "platform": "linux",
                "version": "9.9.10",
              },
            },
          ],
          "result": {
            "exitCode": 0,
            "output": "omo updated 9.9.9 -> 9.9.10",
          },
        },
        "update senpi": {
          "calls": [
            "fetch-releases",
            {
              "install": {
                "asset": "omo-linux-x64",
                "destination": "/opt/omo-release/omo",
                "platform": "linux",
                "version": "9.9.10",
              },
            },
          ],
          "result": {
            "exitCode": 0,
            "output": "omo updated 9.9.9 -> 9.9.10",
          },
        },
      }
    `)
  })

  test("#given each print-only spelling #then it prints the replace command and installs nothing", async () => {
    expect(
      await compiledTable([
        ["update", "--dry-run"],
        ["update", "--print"],
        ["update", "--self", "--print"],
      ]),
    ).toMatchInlineSnapshot(`
      {
        "update --dry-run": {
          "calls": [
            "fetch-releases",
          ],
          "result": {
            "exitCode": 0,
            "output": 
      "omo 9.9.10 is available (running 9.9.9). Replace this binary with:
      curl -fsSL 'https://github.com/code-yeongyu/oh-my-openagent/releases/download/v9.9.10/omo-linux-x64' -o '/opt/omo-release/omo.new' && chmod +x '/opt/omo-release/omo.new' && mv -f '/opt/omo-release/omo.new' '/opt/omo-release/omo'"
      ,
          },
        },
        "update --print": {
          "calls": [
            "fetch-releases",
          ],
          "result": {
            "exitCode": 0,
            "output": 
      "omo 9.9.10 is available (running 9.9.9). Replace this binary with:
      curl -fsSL 'https://github.com/code-yeongyu/oh-my-openagent/releases/download/v9.9.10/omo-linux-x64' -o '/opt/omo-release/omo.new' && chmod +x '/opt/omo-release/omo.new' && mv -f '/opt/omo-release/omo.new' '/opt/omo-release/omo'"
      ,
          },
        },
        "update --self --print": {
          "calls": [
            "fetch-releases",
          ],
          "result": {
            "exitCode": 0,
            "output": 
      "omo 9.9.10 is available (running 9.9.9). Replace this binary with:
      curl -fsSL 'https://github.com/code-yeongyu/oh-my-openagent/releases/download/v9.9.10/omo-linux-x64' -o '/opt/omo-release/omo.new' && chmod +x '/opt/omo-release/omo.new' && mv -f '/opt/omo-release/omo.new' '/opt/omo-release/omo'"
      ,
          },
        },
      }
    `)
  })

  test("#given help and each flag update does not know #then each is answered before any lookup", async () => {
    expect(
      await compiledTable([
        ["update", "--help"],
        ["update", "-h"],
        ["update", "--all"],
        ["update", "--force"],
        ["update", "--forse"],
      ]),
    ).toMatchInlineSnapshot(`
      {
        "update --all": {
          "calls": [],
          "result": {
            "exitCode": 2,
            "output": 
      "omo update: unknown option --all
      Run omo update --help for usage."
      ,
            "stream": "stderr",
          },
        },
        "update --force": {
          "calls": [],
          "result": {
            "exitCode": 2,
            "output": 
      "omo update: unknown option --force
      Run omo update --help for usage."
      ,
            "stream": "stderr",
          },
        },
        "update --forse": {
          "calls": [],
          "result": {
            "exitCode": 2,
            "output": 
      "omo update: unknown option --forse
      Run omo update --help for usage."
      ,
            "stream": "stderr",
          },
        },
        "update --help": {
          "calls": [],
          "result": {
            "exitCode": 0,
            "output": 
      "Usage: omo update [--dry-run | --print]

      Update omo to the newest release on its channel. The engine is pinned by omo and moves with it.

      Options:
        --dry-run, --print  print the update command without running it
        -h, --help          show this help"
      ,
            "stream": "stdout",
          },
        },
        "update -h": {
          "calls": [],
          "result": {
            "exitCode": 0,
            "output": 
      "Usage: omo update [--dry-run | --print]

      Update omo to the newest release on its channel. The engine is pinned by omo and moves with it.

      Options:
        --dry-run, --print  print the update command without running it
        -h, --help          show this help"
      ,
            "stream": "stdout",
          },
        },
      }
    `)
  })

  test("#given no newer release #then it reports the newest stable and installs nothing", async () => {
    expect(await compiled(["update"], { releases: async () => [{ tag_name: "v9.9.9", assets: [{ name: ASSET }] }] }))
      .toMatchInlineSnapshot(`
        {
          "calls": [
            "fetch-releases",
          ],
          "result": {
            "exitCode": 0,
            "output": "omo 9.9.9 is the newest stable release",
          },
        }
      `)
  })

  test("#given the release list cannot be read #then it names the asset to download", async () => {
    expect(
      await compiled(["update"], {
        releases: async () => {
          throw new Error("GitHub answered 503")
        },
      }),
    ).toMatchInlineSnapshot(`
      {
        "calls": [
          "fetch-releases",
        ],
        "result": {
          "exitCode": 1,
          "output": "omo update could not resolve a release (GitHub answered 503). Download omo-linux-x64 from https://github.com/code-yeongyu/oh-my-openagent/releases",
        },
      }
    `)
  })

  test("#given a binary a system package manager owns #then it names that manager and looks nothing up", async () => {
    expect(await compiled(["update"], { owner: true })).toMatchInlineSnapshot(`
      {
        "calls": [],
        "result": {
          "exitCode": 1,
          "output": "omo: installed via dpkg (omo); update it with apt, e.g. \`sudo apt install --only-upgrade omo\`",
          "stream": "stderr",
        },
      }
    `)
  })

  test("#given the provisioned runtime copy as the destination #then it names the installer", async () => {
    expect(await compiled(["update"], { destination: PROVISIONED })).toMatchInlineSnapshot(`
      {
        "calls": [
          "fetch-releases",
        ],
        "result": {
          "exitCode": 1,
          "output": 
      "omo 9.9.10 is available (running 9.9.9), but /home/user/.omo/binary-runtime/9.9.9/omo is the provisioned runtime copy, not the installed omo. Update the installed omo with:
      curl -fsSL https://get.omo.dev/install.sh | bash"
      ,
          "stream": "stderr",
        },
      }
    `)
  })

  test("#given a binary install that fails #then the typed code and a one-line reason come back", async () => {
    expect(await compiled(["update"], { install: "fail" })).toMatchInlineSnapshot(`
      {
        "calls": [
          "fetch-releases",
          {
            "install": {
              "asset": "omo-linux-x64",
              "destination": "/opt/omo-release/omo",
              "platform": "linux",
              "version": "9.9.10",
            },
          },
        ],
        "result": {
          "errorCode": "install_failed",
          "exitCode": 1,
          "output": "omo update: install_failed: checksum mismatch for omo-linux-x64 second line",
          "stream": "stderr",
        },
      }
    `)
  })
})

async function captureConsole<T>(
  run: () => T | Promise<T>,
): Promise<{ value: T; out: string[]; err: string[]; exitCode: unknown }> {
  const out: string[] = []
  const err: string[] = []
  const [log, error] = [console.log, console.error]
  const exitBefore = process.exitCode
  process.exitCode = 0
  console.log = (value?: unknown) => {
    out.push(String(value))
  }
  console.error = (value?: unknown) => {
    err.push(String(value))
  }
  try {
    const value = await run()
    return { value, out, err, exitCode: process.exitCode }
  } finally {
    console.log = log
    console.error = error
    process.exitCode = exitBefore
  }
}

describe("C1c pins: the compiled entry's answers", () => {
  const manifest = { omoAiVersion: "9.9.9", enginePin: "2026.1.1", buildInfo: undefined, engineBuild: undefined }

  test("#given the fast path and each version and update spelling #then each answer is pinned", async () => {
    const hostAsset = releaseAssetName(undefined, process.platform, process.arch)
    const answers: [string, unknown][] = []
    for (const args of [
      ["--version"],
      ["-v"],
      ["update"],
      ["update", "--dry-run"],
      ["update", "--help"],
      ["update", "--force"],
    ]) {
      const captured = await captureConsole(() => answerCompiledFastPath(args, manifest))
      answers.push([
        args.join(" "),
        { ...captured, out: captured.out.map((line) => line.replaceAll(hostAsset, "<ASSET>")) },
      ])
    }
    expect(Object.fromEntries(answers)).toMatchInlineSnapshot(`
      {
        "--version": {
          "err": [],
          "exitCode": 0,
          "out": [
            "omo 9.9.9 (engine: senpi 2026.1.1; scheme nodef)",
          ],
          "value": true,
        },
        "-v": {
          "err": [],
          "exitCode": 0,
          "out": [
            "omo 9.9.9 (engine: senpi 2026.1.1; scheme nodef)",
          ],
          "value": true,
        },
        "update": {
          "err": [],
          "exitCode": 0,
          "out": [
            "omo update runs from the compiled omo binary; download <ASSET> from https://github.com/code-yeongyu/oh-my-openagent/releases",
          ],
          "value": true,
        },
        "update --dry-run": {
          "err": [],
          "exitCode": 0,
          "out": [
            "omo update runs from the compiled omo binary; download <ASSET> from https://github.com/code-yeongyu/oh-my-openagent/releases",
          ],
          "value": true,
        },
        "update --force": {
          "err": [
            
      "omo update: unknown option --force
      Run omo update --help for usage."
      ,
          ],
          "exitCode": 2,
          "out": [],
          "value": true,
        },
        "update --help": {
          "err": [],
          "exitCode": 0,
          "out": [
            
      "Usage: omo update [--dry-run | --print]

      Update omo to the newest release on its channel. The engine is pinned by omo and moves with it.

      Options:
        --dry-run, --print  print the update command without running it
        -h, --help          show this help"
      ,
          ],
          "value": true,
        },
      }
    `)
  })

  test("#given a dev build's stamp #then update names the rebuild command", async () => {
    const buildInfo = {
      command: "omob",
      omo: { commit: "a".repeat(40), committedAt: "2026-11-25T00:00:00+09:00", branch: "dev" },
      engine: { commit: "b".repeat(40), committedAt: "2026-11-25T00:00:00+09:00", branch: "main" },
    }
    expect(await captureConsole(() => answerCompiledFastPath(["update"], { ...manifest, buildInfo })))
      .toMatchInlineSnapshot(`
      {
        "err": [],
        "exitCode": 0,
        "out": [
          "rebuild with: bun run omob",
        ],
        "value": true,
      }
    `)
  })

  test("#given the provisioned launcher and each version and update spelling #then each answer is pinned", async () => {
    const root = tempRoot("omo-c1c-compiled-")
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "9.9.9" }))
    const hostAsset = releaseAssetName(undefined, process.platform, process.arch)
    const answers: Record<string, { handled: boolean; out: string[]; err: string[]; exitCode: unknown }> = {}
    for (const args of [["--version"], ["-v"], ["update"], ["update", "--help"], ["update", "--force"]]) {
      const captured = await captureConsole(() => runCompiledLauncher(args, root, "2026.1.1"))
      answers[args.join(" ")] = {
        handled: captured.value,
        out: captured.out.map((line) => line.replaceAll(hostAsset, "<ASSET>")),
        err: captured.err,
        exitCode: captured.exitCode,
      }
    }
    expect(answers).toMatchInlineSnapshot(`
      {
        "--version": {
          "err": [],
          "exitCode": 0,
          "handled": true,
          "out": [
            "omo 9.9.9 (engine: senpi 2026.1.1; scheme nodef)",
          ],
        },
        "-v": {
          "err": [],
          "exitCode": 0,
          "handled": true,
          "out": [
            "omo 9.9.9 (engine: senpi 2026.1.1; scheme nodef)",
          ],
        },
        "update": {
          "err": [],
          "exitCode": 0,
          "handled": true,
          "out": [
            "omo update runs from the compiled omo binary; download <ASSET> from https://github.com/code-yeongyu/oh-my-openagent/releases",
          ],
        },
        "update --force": {
          "err": [
            
      "omo update: unknown option --force
      Run omo update --help for usage."
      ,
          ],
          "exitCode": 2,
          "handled": true,
          "out": [],
        },
        "update --help": {
          "err": [],
          "exitCode": 0,
          "handled": true,
          "out": [
            
      "Usage: omo update [--dry-run | --print]

      Update omo to the newest release on its channel. The engine is pinned by omo and moves with it.

      Options:
        --dry-run, --print  print the update command without running it
        -h, --help          show this help"
      ,
          ],
        },
      }
    `)
  })
})

type SetupFixture = { root: string; home: string; agentDir: string; xdg: string; launcher: string }

function setupFixture(options: { pending: boolean }): SetupFixture {
  const root = tempRoot("omo-c1c-setup-")
  const home = join(root, "home")
  const agentDir = join(root, "senpi-agent")
  const xdg = join(root, "xdg")
  const app = join(root, "app")
  mkdirSync(home, { recursive: true })
  cpSync(join(SOURCE_ROOT, "bin"), join(app, "bin"), { recursive: true })
  writeFile(join(app, "package.json"), JSON.stringify({ name: "omo-ai", version: "test", type: "module" }))
  if (options.pending)
    writeFile(join(xdg, "opencode", "auth.json"), JSON.stringify({ google: { type: "api", key: CANARY } }))
  return { root, home, agentDir, xdg, launcher: join(app, "bin", "omo.js") }
}

function runSetupFixture(fixture: SetupFixture, args: string[], tty?: { answer: string; marker: string }) {
  const env = hermeticEnv({
    HOME: fixture.home,
    USERPROFILE: fixture.home,
    SENPI_CODING_AGENT_DIR: fixture.agentDir,
    XDG_DATA_HOME: fixture.xdg,
    XDG_CONFIG_HOME: join(fixture.root, "xdg-config"),
    XDG_CACHE_HOME: join(fixture.root, "xdg-cache"),
  })
  const spawned =
    tty === undefined
      ? spawnSync(process.execPath, [fixture.launcher, "setup", ...args], { encoding: "utf8", env })
      : spawnSync(
          "python3",
          [TTY_DRIVER, tty.answer, tty.marker, process.execPath, fixture.launcher, "setup", ...args],
          {
            encoding: "utf8",
            env,
          },
        )
  const result = outcome(spawned, fixture.root)
  expect(`${result.stdout}${result.stderr}`).not.toContain(CANARY)
  const authFile = join(fixture.agentDir, "auth.json")
  const imported = existsSync(authFile) ? Object.keys(JSON.parse(readFileSync(authFile, "utf8"))).sort() : null
  return { ...result, imported }
}

describe("C1c pins: omo setup", () => {
  test("#given --dry-run #then it prints the plan and writes nothing", () => {
    expect(runSetupFixture(setupFixture({ pending: true }), ["--dry-run"])).toMatchInlineSnapshot(`
      {
        "imported": null,
        "status": 0,
        "stderr": "",
        "stdout": 
      "DRY RUN: no files will be written
      Found your OpenCode setup
        logins        1 API key (google) - will be imported
      Model-to-agent guidance: docs/guide/agent-model-matching.md
      OmO sends anonymous usage telemetry (no prompts, code, file paths, or account data) to improve the product.
      The data goes to PostHog in the United States (https://us.i.posthog.com) and the OmO telemetry collector (https://t.omo.dev).
      Turn it off with DO_NOT_TRACK=1 (or OMO_DISABLE_TELEMETRY=1).
      Details: https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/legal/privacy-policy.md
      planned-add: google
      skipped-existing: none
      skipped-oauth: none
      skipped-unmapped: none
      "
      ,
      }
    `)
  })

  test("#given --yes #then it imports the whole plan without asking", () => {
    expect(runSetupFixture(setupFixture({ pending: true }), ["--yes"])).toMatchInlineSnapshot(`
      {
        "imported": [
          "google",
        ],
        "status": 0,
        "stderr": "",
        "stdout": 
      "Found your OpenCode setup
        logins        1 API key (google) - will be imported
      Model-to-agent guidance: docs/guide/agent-model-matching.md
      OmO sends anonymous usage telemetry (no prompts, code, file paths, or account data) to improve the product.
      The data goes to PostHog in the United States (https://us.i.posthog.com) and the OmO telemetry collector (https://t.omo.dev).
      Turn it off with DO_NOT_TRACK=1 (or OMO_DISABLE_TELEMETRY=1).
      Details: https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/legal/privacy-policy.md
      imported: 1
      skipped-existing: 0
      skipped-oauth: 0
      skipped-unmapped: 0
      "
      ,
      }
    `)
  })

  test("#given no flag and no terminal #then it imports nothing and names --yes", () => {
    expect(runSetupFixture(setupFixture({ pending: true }), [])).toMatchInlineSnapshot(`
      {
        "imported": null,
        "status": 0,
        "stderr": "",
        "stdout": 
      "Found your OpenCode setup
        logins        1 API key (google) - will be imported
      Model-to-agent guidance: docs/guide/agent-model-matching.md
      OmO sends anonymous usage telemetry (no prompts, code, file paths, or account data) to improve the product.
      The data goes to PostHog in the United States (https://us.i.posthog.com) and the OmO telemetry collector (https://t.omo.dev).
      Turn it off with DO_NOT_TRACK=1 (or OMO_DISABLE_TELEMETRY=1).
      Details: https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/legal/privacy-policy.md
      Non-interactive setup did not import. Re-run with \`omo setup --yes\`.
      "
      ,
      }
    `)
  })

  test("#given --ask-each and no terminal #then it imports nothing and names --yes", () => {
    expect(runSetupFixture(setupFixture({ pending: true }), ["--ask-each"])).toMatchInlineSnapshot(`
      {
        "imported": null,
        "status": 0,
        "stderr": "",
        "stdout": 
      "Found your OpenCode setup
        logins        1 API key (google) - will be imported
      Model-to-agent guidance: docs/guide/agent-model-matching.md
      OmO sends anonymous usage telemetry (no prompts, code, file paths, or account data) to improve the product.
      The data goes to PostHog in the United States (https://us.i.posthog.com) and the OmO telemetry collector (https://t.omo.dev).
      Turn it off with DO_NOT_TRACK=1 (or OMO_DISABLE_TELEMETRY=1).
      Details: https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/legal/privacy-policy.md
      Non-interactive setup did not import. Re-run with \`omo setup --yes\`.
      "
      ,
      }
    `)
  })

  test("#given nothing pending #then it says so and writes nothing", () => {
    expect(runSetupFixture(setupFixture({ pending: false }), [])).toMatchInlineSnapshot(`
      {
        "imported": null,
        "status": 0,
        "stderr": "",
        "stdout": 
      "No OpenCode setup found
        nothing omo can import
      Model-to-agent guidance: docs/guide/agent-model-matching.md
      Ready-to-paste omo.json models catalog template:
      {
        "models": {
          "primary": {
            "model": "<provider>/<model-id>",
            "reasoning": "<off|low|medium|high|max>"
          },
          "custom-endpoint": {
            "model": "<custom-baseUrl-provider>/<model-id>"
          }
        }
      }
      For custom endpoints, define the provider baseUrl in the engine's models.json, then use that provider id above.
      OmO sends anonymous usage telemetry (no prompts, code, file paths, or account data) to improve the product.
      The data goes to PostHog in the United States (https://us.i.posthog.com) and the OmO telemetry collector (https://t.omo.dev).
      Turn it off with DO_NOT_TRACK=1 (or OMO_DISABLE_TELEMETRY=1).
      Details: https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/legal/privacy-policy.md
      Nothing new to import.
      imported: 0
      skipped-existing: 0
      skipped-oauth: 0
      skipped-unmapped: 0
      "
      ,
      }
    `)
  })

  describe.skipIf(process.platform === "win32")("on a terminal", () => {
    test("#given no flag and the one confirmation accepted #then it imports the whole plan", () => {
      expect(runSetupFixture(setupFixture({ pending: true }), [], { answer: "y\n", marker: "[Y/n]" }))
        .toMatchInlineSnapshot(`
        {
          "imported": [
            "google",
          ],
          "status": 0,
          "stderr": "",
          "stdout": 
        "Found your OpenCode setup
          logins        1 API key (google) - will be imported
        Model-to-agent guidance: docs/guide/agent-model-matching.md
        OmO sends anonymous usage telemetry (no prompts, code, file paths, or account data) to improve the product.
        The data goes to PostHog in the United States (https://us.i.posthog.com) and the OmO telemetry collector (https://t.omo.dev).
        Turn it off with DO_NOT_TRACK=1 (or OMO_DISABLE_TELEMETRY=1).
        Details: https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/legal/privacy-policy.md
        Import all of the above into <ROOT>/senpi-agent? [Y/n] <answered>
        imported: 1
        skipped-existing: 0
        skipped-oauth: 0
        skipped-unmapped: 0
        "
        ,
        }
      `)
    })

    test("#given no flag and the one confirmation refused #then nothing is imported", () => {
      expect(runSetupFixture(setupFixture({ pending: true }), [], { answer: "n\n", marker: "[Y/n]" }))
        .toMatchInlineSnapshot(`
        {
          "imported": null,
          "status": 0,
          "stderr": "",
          "stdout": 
        "Found your OpenCode setup
          logins        1 API key (google) - will be imported
        Model-to-agent guidance: docs/guide/agent-model-matching.md
        OmO sends anonymous usage telemetry (no prompts, code, file paths, or account data) to improve the product.
        The data goes to PostHog in the United States (https://us.i.posthog.com) and the OmO telemetry collector (https://t.omo.dev).
        Turn it off with DO_NOT_TRACK=1 (or OMO_DISABLE_TELEMETRY=1).
        Details: https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/legal/privacy-policy.md
        Import all of the above into <ROOT>/senpi-agent? [Y/n] <answered>
        Import cancelled
        "
        ,
        }
      `)
    })

    test("#given --ask-each and the stage accepted #then that stage imports", () => {
      expect(runSetupFixture(setupFixture({ pending: true }), ["--ask-each"], { answer: "y\n", marker: "[y/N]" }))
        .toMatchInlineSnapshot(`
        {
          "imported": [
            "google",
          ],
          "status": 0,
          "stderr": "",
          "stdout": 
        "Found your OpenCode setup
          logins        1 API key (google) - will be imported
        Model-to-agent guidance: docs/guide/agent-model-matching.md
        OmO sends anonymous usage telemetry (no prompts, code, file paths, or account data) to improve the product.
        The data goes to PostHog in the United States (https://us.i.posthog.com) and the OmO telemetry collector (https://t.omo.dev).
        Turn it off with DO_NOT_TRACK=1 (or OMO_DISABLE_TELEMETRY=1).
        Details: https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/legal/privacy-policy.md
        Import API credentials for google into <ROOT>/senpi-agent/auth.json? [y/N] <answered>
        imported: 1
        skipped-existing: 0
        skipped-oauth: 0
        skipped-unmapped: 0
        "
        ,
        }
      `)
    })

    test("#given --ask-each and the stage refused #then nothing is imported", () => {
      expect(runSetupFixture(setupFixture({ pending: true }), ["--ask-each"], { answer: "n\n", marker: "[y/N]" }))
        .toMatchInlineSnapshot(`
        {
          "imported": null,
          "status": 0,
          "stderr": "",
          "stdout": 
        "Found your OpenCode setup
          logins        1 API key (google) - will be imported
        Model-to-agent guidance: docs/guide/agent-model-matching.md
        OmO sends anonymous usage telemetry (no prompts, code, file paths, or account data) to improve the product.
        The data goes to PostHog in the United States (https://us.i.posthog.com) and the OmO telemetry collector (https://t.omo.dev).
        Turn it off with DO_NOT_TRACK=1 (or OMO_DISABLE_TELEMETRY=1).
        Details: https://github.com/code-yeongyu/oh-my-openagent/blob/dev/docs/legal/privacy-policy.md
        Import API credentials for google into <ROOT>/senpi-agent/auth.json? [y/N] <answered>
        Import cancelled
        "
        ,
        }
      `)
    })
  })
})
