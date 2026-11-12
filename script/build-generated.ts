#!/usr/bin/env bun
// Builds every generated output on script/generated-bundles.json by running RELEASE_GENERATORS, plus the tracked daemon
// launch spec, so the tree check that follows covers it (#13192). None of the listed outputs is tracked, so anything that
// reads one from a checkout builds first. Inputs come first: build-install.mjs bundles the local launcher, which imports
// the brand logo module.
// Run as `bun script/build-generated.ts`.
import { fileURLToPath } from "node:url"

import { RELEASE_GENERATORS } from "./generated-bundles.ts"

const root = fileURLToPath(new URL("..", import.meta.url))

for (const generator of RELEASE_GENERATORS) {
  console.log(`build-generated: ${generator.script}`)
  const runtime = generator.runtime === "node" ? "node" : process.execPath
  const child = Bun.spawn([runtime, generator.script], { cwd: root, stdio: ["inherit", "inherit", "inherit"] })
  const exitCode = await child.exited
  if (exitCode !== 0) {
    console.error(`build-generated: ${generator.script} exited ${exitCode}`)
    process.exit(exitCode)
  }
}
