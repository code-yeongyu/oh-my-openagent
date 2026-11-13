#!/usr/bin/env bun
// Builds every generated output on script/generated-bundles.json by running RELEASE_GENERATORS, the generators the
// release job runs. Feature PRs never commit these outputs (#9903), so anything that reads them from a checkout builds
// first. Run as `bun script/build-generated.ts`.
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
