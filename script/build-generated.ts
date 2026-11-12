#!/usr/bin/env bun
// Builds every generated output on script/generated-bundles.json: the generators the release job runs (publish.yml,
// prepare job). Feature PRs never commit these outputs (#9903), so anything that reads them from a checkout builds
// first. Run as `bun script/build-generated.ts`.
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))

const GENERATORS: readonly (readonly string[])[] = [
  ["node", "packages/omo-senpi/plugin/scripts/build-extension.mjs"],
  [process.execPath, "script/build-codex-install.ts"],
  [process.execPath, "script/build-service-auth.ts"],
]

for (const command of GENERATORS) {
  console.log(`build-generated: ${command.slice(1).join(" ")}`)
  const child = Bun.spawn([...command], { cwd: root, stdio: ["inherit", "inherit", "inherit"] })
  const exitCode = await child.exited
  if (exitCode !== 0) {
    console.error(`build-generated: ${command.slice(1).join(" ")} exited ${exitCode}`)
    process.exit(exitCode)
  }
}
