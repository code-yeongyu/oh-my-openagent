#!/usr/bin/env node

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const tempRoot = await mkdtemp(join(tmpdir(), "omo-ask-question-e2e-"))

try {
  const bunfig = join(tempRoot, "bunfig.toml")
  await writeFile(bunfig, "[test]\n", "utf8")
  await run(
    [
      "test",
      "--config",
      bunfig,
      join(packageRoot, "src", "components", "ask-question", "index.test.ts"),
      join(packageRoot, "src", "components", "ask-question", "claude-sdk-bridge.test.ts"),
    ],
    {
      cwd: packageRoot,
      env: process.env,
    },
  )

  const bundle = join(tempRoot, "ask-question.js")
  await run(
    [
      "build",
      join(packageRoot, "src", "components", "ask-question", "index.ts"),
      "--target",
      "node",
      "--format",
      "esm",
      "--outfile",
      bundle,
      "--external",
      "@code-yeongyu/senpi",
      "--external",
      "typebox",
    ],
    { cwd: packageRoot },
  )

  console.log(JSON.stringify({
    result: "PASS",
    surfaces: ["tui-select", "rpc-select", "custom-input", "multi-select", "claude-sdk-custom-tool"],
    bundle,
  }))
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

async function run(args, options) {
  await mkdir(options.cwd, { recursive: true })
  const child = Bun.spawn(["bun", ...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdout: "inherit",
    stderr: "inherit",
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`bun ${args.join(" ")} exited ${exitCode}`)
}
