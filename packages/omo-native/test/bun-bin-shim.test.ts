import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, lstatSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { bunBinShimScript, ensureBunBinShim } from "../bin/lib/bun-bin-shim.js"
import {
  baseInput,
  bunTreePackage,
  NON_POSIX_HOST,
  POSIX_HOME,
  recorder,
  stockLinkTarget,
} from "./bun-bin-shim.test-support"
import { POSIX_ONLY, createFixture, launchViaNode, launchShim, launchEntry, capture, removeFixtureRoots } from "./bun-bin-shim.fixture"

afterEach(removeFixtureRoots)


describe("bun launcher bin shim", () => {
  describe("#given the generated shim script", () => {
    test("#then it execs bun on the entrypoint and falls back to the entrypoint's own shebang", () => {
      // given
      const script = bunBinShimScript("/opt/x/bin/omo.js", "/home/dev/.bun/bin/bun")
      // when / then
      expect(script.split("\n")[0]).toBe("#!/bin/sh")
      expect(script).toContain(`exec '/home/dev/.bun/bin/bun' '/opt/x/bin/omo.js' "$@"`)
      // The fallback re-execs the entrypoint, whose `#!/usr/bin/env node` line is the exact path
      // the stock symlink used, so OMO_RUNTIME=node and a vanished bun both stay on node.
      expect(script.trimEnd().split("\n").at(-1)).toBe(`exec '/opt/x/bin/omo.js' "$@"`)
      expect(script).toContain(`if [ "$OMO_RUNTIME" != "node" ]`)
    })

    test("#then a path containing a single quote stays one shell word", () => {
      // given / when
      const script = bunBinShimScript("/opt/it's/bin/omo.js", "/home/dev/.bun/bin/bun")
      // then - the quoted form re-opens the string around the apostrophe; sh reassembles one word
      expect(script).toContain(`exec '/opt/it'\\''s/bin/omo.js' "$@"`)
    })
  })

  describe.skipIf(NON_POSIX_HOST)("#given a stock bun bin symlink pointing at this install", () => {
    test("#then a launch running on bun repairs it too (#9293)", () => {
      // given: bun is the runtime - bun's postinstall on a machine without node, or `bun omo.js`
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options, bunRootDir, bunPath } = baseInput(scriptPath, { versions: { bun: "1.4.2" } })
      const binPath = join(bunRootDir, "bin", "omo")
      const fs = recorder()
      fs.markLink(binPath)
      // when
      const result = ensureBunBinShim({
        ...options,
        realpath: (path: string) => (path === binPath ? scriptPath : path),
        ...fs,
      })
      // then
      expect(result.action).toBe("repaired")
      expect(fs.written[0]?.content).toBe(bunBinShimScript(scriptPath, bunPath))
    })

    test("#then it is replaced by an executable shim through an atomic rename", () => {
      // given
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options, bunRootDir, bunPath } = baseInput(scriptPath)
      const binPath = join(bunRootDir, "bin", "omo")
      const fs = recorder()
      fs.markLink(binPath)
      // when
      const result = ensureBunBinShim({
        ...options,
        realpath: (path: string) => (path === binPath ? scriptPath : path),
        ...fs,
      })
      // then
      expect(result.action).toBe("repaired")
      expect(fs.written).toEqual([
        { path: `${binPath}.4242.tmp`, content: bunBinShimScript(scriptPath, bunPath), mode: 0o755 },
      ])
      expect(fs.renamed).toEqual([{ from: `${binPath}.4242.tmp`, to: binPath }])
      // writeFileSync applies umask, so the executable bit is pinned by an explicit follow-up chmod
      expect(fs.chmodded).toEqual([{ path: `${binPath}.4242.tmp`, mode: 0o755 }])
    })

    test("#then an already-current shim writes nothing", () => {
      // given
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options, bunRootDir, bunPath } = baseInput(scriptPath)
      const fs = recorder({ [join(bunRootDir, "bin", "omo")]: bunBinShimScript(scriptPath, bunPath) })
      // when
      const result = ensureBunBinShim({ ...options, ...fs })
      // then
      expect(result.action).toBe("current")
      expect(fs.written).toHaveLength(0)
      expect(fs.renamed).toHaveLength(0)
    })

    test("#then a shim from an older generator version is rewritten", () => {
      // given
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options, bunRootDir, bunPath } = baseInput(scriptPath)
      const binPath = join(bunRootDir, "bin", "omo")
      const fs = recorder({
        [binPath]: `#!/bin/sh\n# omo-ai bun launcher shim v0 - older generator\nexec '${bunPath}' '${scriptPath}' "$@"\n`,
      })
      // when
      const result = ensureBunBinShim({ ...options, ...fs })
      // then
      expect(result.action).toBe("repaired")
      expect(fs.written[0]?.content).toBe(bunBinShimScript(scriptPath, bunPath))
    })
  })

  describe.skipIf(NON_POSIX_HOST)("#given the bin path is not ours to touch", () => {
    test("#then a symlink into another package is left alone", () => {
      // given
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options, bunRootDir } = baseInput(scriptPath)
      const binPath = join(bunRootDir, "bin", "omo")
      const fs = recorder()
      fs.markLink(binPath)
      // when
      const result = ensureBunBinShim({
        ...options,
        realpath: (path: string) => (path === binPath ? "/usr/local/lib/node_modules/omo-ai/bin/omo.js" : path),
        ...fs,
      })
      // then
      expect(result.action).toBe("foreign-link")
      expect(fs.written).toHaveLength(0)
    })

    test("#then a file without the shim marker is left alone", () => {
      // given
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options, bunRootDir } = baseInput(scriptPath)
      const fs = recorder({ [join(bunRootDir, "bin", "omo")]: "#!/bin/sh\nexec something-else\n" })
      // when
      const result = ensureBunBinShim({ ...options, ...fs })
      // then
      expect(result.action).toBe("foreign-file")
      expect(fs.written).toHaveLength(0)
    })

    test("#then a missing bin path is a no-op, not a creation", () => {
      // given
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options } = baseInput(scriptPath)
      const fs = recorder()
      // when
      const result = ensureBunBinShim({ ...options, ...fs })
      // then
      expect(result.action).toBe("absent-bin")
      expect(fs.written).toHaveLength(0)
    })
  })

  describe("#given the launch context rules the repair out", () => {
    const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))

    test("#then Windows never repairs, whatever it finds", () => {
      // given
      const { options } = baseInput(scriptPath, { platform: "win32" })
      const fs = recorder()
      // when
      const result = ensureBunBinShim({ ...options, ...fs })
      // then - npm's .cmd/.ps1 shims exec the bin file through its shebang, so on Windows the file
      // must stay exactly what bun/npm linked
      expect(result.action).toBe("skipped-platform")
      expect(fs.written).toHaveLength(0)
    })

    test("#then an npm-layout install skips the check entirely", () => {
      // given
      const { options } = baseInput("/usr/local/lib/node_modules/omo-ai/bin/omo.js")
      const fs = recorder()
      // when
      const result = ensureBunBinShim({ ...options, ...fs })
      // then
      expect(result.action).toBe("skipped-install")
    })

    test("#then a machine without bun has nothing to optimize with", () => {
      // given
      const { options } = baseInput(scriptPath, { exists: () => false })
      const fs = recorder()
      // when
      const result = ensureBunBinShim({ ...options, ...fs })
      // then
      expect(result.action).toBe("skipped-no-bun")
      expect(fs.written).toHaveLength(0)
    })
  })

  describe.skipIf(NON_POSIX_HOST)("#given the repair path fails", () => {
    test("#then the failure is swallowed and never breaks the launch", () => {
      // given
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options, bunRootDir } = baseInput(scriptPath)
      const binPath = join(bunRootDir, "bin", "omo")
      const fs = recorder()
      fs.markLink(binPath)
      const failing = {
        ...fs,
        realpath: (path: string) => (path === binPath ? scriptPath : path),
        write: () => {
          throw new Error("EACCES: permission denied")
        },
      }
      // when
      const result = ensureBunBinShim({ ...options, ...failing })
      // then
      expect(result.action).toBe("failed")
      expect(result.error).toBe("EACCES: permission denied")
    })

    test("#then OMO_DEBUG narrates the swallowed failure", () => {
      // given
      const scriptPath = bunTreePackage(join(POSIX_HOME, ".bun"))
      const { options, bunRootDir } = baseInput(scriptPath, { env: { OMO_DEBUG: "1" } })
      const binPath = join(bunRootDir, "bin", "omo")
      const fs = recorder()
      fs.markLink(binPath)
      const warnings: string[] = []
      const failing = {
        ...fs,
        realpath: (path: string) => (path === binPath ? scriptPath : path),
        write: () => {
          throw new Error("EROFS: read-only file system")
        },
        warn: (message: string) => warnings.push(message),
      }
      // when
      ensureBunBinShim({ ...options, ...failing })
      // then
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain(binPath)
      expect(warnings[0]).toContain("EROFS")
    })
  })

  describe("#given a real synthetic bun global tree driven by node", () => {
    // The shim is a launch-surface artifact; its contract (what the kernel execs, which runtime
    // ends up running the engine, what a repair does to a live tree) is only honest when driven
    // through a real node process and a real exec. POSIX only: the shim is a POSIX feature and
    // creating the stock symlink needs privileges Windows CI does not grant.
    test.skipIf(POSIX_ONLY)("#then the first launch replaces the symlink and hands later launches to bun", () => {
      // given
      const fixture = createFixture()

      // when: the first launch happens through the stock symlink, exactly as a user types `omo`
      const first = launchViaNode(fixture, ["--version"])
      // then: the launch still answers (the re-exec hands it to the fixture's bun) and the bin is
      // now an executable, sh-valid shim carrying the freshly discovered bun path
      expect(first.status).toBe(42)
      expect(readFileSync(fixture.markerFile, "utf8")).toBe("fake-bun-ran")
      expect(lstatSync(fixture.binPath).isSymbolicLink()).toBe(false)
      expect((statSync(fixture.binPath).mode & 0o111) !== 0).toBe(true)
      expect(readFileSync(fixture.binPath, "utf8")).toBe(bunBinShimScript(fixture.launcher, fixture.bunBinary))
      expect(spawnSync("/bin/sh", ["-n", fixture.binPath]).status).toBe(0)

      // when: the next launch execs the shim itself; node is not involved at all
      rmSync(fixture.markerFile)
      const second = launchShim(fixture, ["say", "hi"])
      // then: the shim's bun branch ran, and the engine was never reached
      expect(second.status).toBe(42)
      expect(readFileSync(fixture.markerFile, "utf8")).toBe("fake-bun-ran")
      expect(existsSync(fixture.captureFile)).toBe(false)
    })

    test.skipIf(POSIX_ONLY)("#then OMO_RUNTIME=node stays on node end to end", () => {
      // given
      const fixture = createFixture()
      launchViaNode(fixture, ["--version"])

      // when: the shim itself runs with OMO_RUNTIME=node
      const result = launchShim(fixture, ["say", "hi"], { OMO_RUNTIME: "node" })
      // then: launcher AND engine both ran on node - the engine capture is the end-to-end proof
      expect(result.status).toBe(0)
      const captured = capture(fixture)
      expect(captured.env.SENPI_RUNTIME).toBe("node")
      expect(captured.versions.bun).toBeUndefined()
      expect(captured.argv).toContain("say")
    })

    test.skipIf(POSIX_ONLY)("#then a bun add -g update that restores the symlink is healed on the next launch", () => {
      // given
      const fixture = createFixture()
      launchViaNode(fixture, ["--version"])
      expect(lstatSync(fixture.binPath).isSymbolicLink()).toBe(false)
      // when: `bun add -g` rewrites the bin link over the shim (verified against real bun in QA)
      rmSync(fixture.binPath)
      symlinkSync(stockLinkTarget(), fixture.binPath)
      const healed = launchViaNode(fixture, ["--version"])
      // then
      expect(healed.status).toBe(42)
      expect(lstatSync(fixture.binPath).isSymbolicLink()).toBe(false)
      expect(readFileSync(fixture.binPath, "utf8")).toBe(bunBinShimScript(fixture.launcher, fixture.bunBinary))
    })

    test.skipIf(POSIX_ONLY)("#then a current shim is not rewritten by later node boots", () => {
      // given
      const fixture = createFixture()
      launchViaNode(fixture, ["--version"])
      // A rewrite would recreate the file with mode 0755, so dropping the executable bit makes
      // any rewrite observable without timing.
      chmodSync(fixture.binPath, 0o644)
      // when: a later node boot of the entrypoint runs the currency check
      const again = launchEntry(fixture, ["--version"], { OMO_RUNTIME: "node" })
      // then: it answered from the node path and left the shim untouched
      expect(again.status).toBe(0)
      expect(again.stdout.trim()).toBe("omo 9.9.9-test.0 (engine: senpi 2026.8.9)")
      expect(statSync(fixture.binPath).mode & 0o777).toBe(0o644)
    })

    test.skipIf(POSIX_ONLY)("#then an unwritable bin dir never breaks the launch", () => {
      // given
      const fixture = createFixture()
      chmodSync(join(fixture.bunInstall, "bin"), 0o555)
      try {
        // when: the repair cannot write, with node pinned so the re-exec cannot mask the failure
        const result = launchEntry(fixture, ["say", "hi"], { OMO_RUNTIME: "node" })
        // then: the launch completed, the engine ran, and the stock link is still there
        expect(result.status).toBe(0)
        expect(capture(fixture).env.SENPI_RUNTIME).toBe("node")
        expect(lstatSync(fixture.binPath).isSymbolicLink()).toBe(true)
      } finally {
        chmodSync(join(fixture.bunInstall, "bin"), 0o755)
      }
    })
  })

})
