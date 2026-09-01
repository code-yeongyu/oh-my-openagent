import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
import { expect, test } from "bun:test"

test("#given Senpi hides rpc-entry from Node exports #when building a fallback spawn #then it uses the physical dist entry", async () => {
  const sourceDir = dirname(import.meta.path)
  const bundleDir = mkdtempSync(join(sourceDir, ".spawn-node-runtime-"))

  try {
    const build = await Bun.build({
      entrypoints: [join(sourceDir, "spawn.ts")],
      outdir: bundleDir,
      target: "node",
      format: "esm",
    })
    expect(build.success).toBe(true)

    const output = build.outputs[0]
    if (output === undefined) throw new TypeError("spawn bundle output is missing")

    const script = `
      import { buildRpcSpawn } from ${JSON.stringify(pathToFileURL(output.path).href)}
      const descriptor = buildRpcSpawn(
        {
          task_id: "st_node_runtime",
          cwd: process.cwd(),
          state_dir: "/tmp/st_node_runtime",
          prompt: "READY",
        },
        {
          isBunBinary: false,
          execPath: process.execPath,
          platform: process.platform,
          parentEnv: { PATH: "" },
          resolveSenpiExecutable: () => null,
        },
      )
      console.log(descriptor.args[0])
    `
    const child = spawnSync("node", ["--input-type=module", "--eval", script], {
      cwd: sourceDir,
      encoding: "utf8",
    })

    expect(`${child.status}\n${child.stderr}`).toBe("0\n")
    expect(child.stdout.trim()).toEndWith(join("dist", "rpc-entry.js"))
  } finally {
    rmSync(bundleDir, { recursive: true, force: true })
  }
})
