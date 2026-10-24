import { expect, test } from "bun:test"
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { legacyShim } from "./bun-bin-shim.test-support"

test.skipIf(process.platform === "win32")("Bun global links survive launch, legacy migration, two upgrades and the CLI updater", async () => {
  // given: real locally packed launchers, served by a loopback registry, with no shared install
  const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-global-upgrade-")))
  const bunInstall = join(root, "bun")
  const home = join(root, "home")
  const packageRoot = join(bunInstall, "install/global/node_modules/omo-ai")
  const bin = join(bunInstall, "bin/omo")
  const bun = join(bunInstall, "bin/bun")
  const versions = ["0.0.1", "0.0.2", "0.0.3", "0.0.4"]
  mkdirSync(join(bunInstall, "bin"), { recursive: true })
  mkdirSync(join(bunInstall, "install/global"), { recursive: true })
  mkdirSync(home)
  symlinkSync(process.execPath, bun)
  const env = {
    HOME: home,
    PATH: `${bunInstall}/bin:/usr/bin:/bin`,
    BUN_INSTALL: bunInstall,
    BUN_INSTALL_CACHE_DIR: join(root, "cache"),
    TMPDIR: root,
    OMO_CODING_AGENT_DIR: join(root, "agent"),
    DO_NOT_TRACK: "1",
  }
  const scripts = { postinstall: "bun bin/prepare-test-install.mjs" }
  const registry = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request): Response {
      const path = new URL(request.url).pathname
      if (path === "/-/package/omo-ai/dist-tags") return Response.json({ latest: "0.0.4" })
      if (path === "/omo-ai") {
        return Response.json({
          name: "omo-ai",
          "dist-tags": { latest: "0.0.4" },
          versions: Object.fromEntries(versions.map(version => [version, {
            name: "omo-ai", version, type: "module", bin: { omo: "bin/omo.js" }, scripts,
            dist: { tarball: `${registry.url}${version}.tgz` },
          }])),
        })
      }
      if (versions.some(version => path === `/${version}.tgz`)) {
        return new Response(Bun.file(join(root, path.slice(1))))
      }
      return new Response("Not found", { status: 404 })
    },
  })
  const run = async (argv: string[], cwd = root) => {
    const child = Bun.spawn(argv, { cwd, env, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    expect({ argv, exitCode, stderr }).toMatchObject({ exitCode: 0 })
    return stdout
  }
  try {
    writeFileSync(join(home, ".bunfig.toml"), `[install]\nregistry = "${registry.url}"\n`)
    writeFileSync(join(bunInstall, "install/global/package.json"), JSON.stringify({ trustedDependencies: ["omo-ai"] }))
    const sourceBin = fileURLToPath(new URL("../bin", import.meta.url))
    for (const version of versions) {
      const stage = join(root, `stage-${version}`)
      mkdirSync(stage)
      cpSync(sourceBin, join(stage, "bin"), { recursive: true })
      writeFileSync(join(stage, "package.json"), JSON.stringify({
        name: "omo-ai", version, type: "module", bin: { omo: "bin/omo.js" }, files: ["bin"], scripts,
      }))
      // The synthetic package has no engine dependency; exercise the same preparation hook.
      writeFileSync(join(stage, "bin/prepare-test-install.mjs"), `
import { ensureBunBinShim } from "./lib/bun-bin-shim.js"
import { fileURLToPath } from "node:url"
ensureBunBinShim({ scriptPath: fileURLToPath(new URL("./omo.js", import.meta.url)) })
`)
      // Redirect only the registry URL. The actual CLI dispatch, updater, Bun subprocess and
      // installed-version verification remain production code, not mocked return values.
      const tags = join(stage, "bin/lib/npm-dist-tags.js")
      const source = readFileSync(tags, "utf8")
      const publicUrl = "https://registry.npmjs.org/-/package/omo-ai/dist-tags"
      expect(source.split(publicUrl)).toHaveLength(2)
      writeFileSync(tags, source.replace(publicUrl, `${registry.url}-/package/omo-ai/dist-tags`))
      await run([process.execPath, "pm", "pack", "--filename", join(root, `${version}.tgz`)], stage)
    }
    await run([bun, "add", "-g", "omo-ai@0.0.1"])
    await run([bin, "--version"])
    expect(lstatSync(bin).isSymbolicLink()).toBe(true)

    const entry = join(packageRoot, "bin/omo.js")
    rmSync(bin)
    writeFileSync(bin, legacyShim(entry, bun), { mode: 0o755 })

    // when: the new launcher migrates its old wrapper before two manual upgrades and an update
    await run([bin, "--version"])
    expect(lstatSync(bin).isSymbolicLink()).toBe(true)
    for (const version of ["0.0.2", "0.0.3"]) {
      await run([bun, "add", "-g", `omo-ai@${version}`])
      await run([bin, "--version"])
      expect(lstatSync(bin).isSymbolicLink()).toBe(true)
    }
    await run([bin, "update"])

    // then: the real updater returns success only after installing its exact target
    expect(JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version).toBe("0.0.4")
    expect(lstatSync(bin).isSymbolicLink()).toBe(true)
    await run([bin, "--version"])
  } finally {
    registry.stop(true)
    rmSync(root, { recursive: true, force: true })
  }
}, 60_000)
