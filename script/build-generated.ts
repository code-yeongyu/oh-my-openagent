#!/usr/bin/env bun
// Builds every generated output on script/generated-bundles.json, plus the tracked daemon launch spec, so the tree check
// that follows covers it (#13192). None of the listed outputs is tracked, so anything that reads one from a checkout
// builds first. Inputs come first: build-install.mjs bundles the local launcher, which imports the brand logo module.
// Run as `bun script/build-generated.ts`.
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))

const GENERATORS: readonly (readonly string[])[] = [
  [process.execPath, "script/build-brand-logo.ts"],
  [process.execPath, "script/build-reflection-lock.ts"],
  [process.execPath, "script/build-service-auth.ts"],
  [process.execPath, "script/build-codex-install.ts"],
  ["node", "packages/omo-senpi/plugin/scripts/build-extension.mjs"],
  ["node", "packages/omo-senpi/plugin/scripts/build-daemon-launch-spec.mjs"],
  ["node", "packages/omo-senpi/plugin/scripts/build-install.mjs"],
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
