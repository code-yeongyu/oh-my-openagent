#!/usr/bin/env bun
// Build the TUI entry point using @opentui/solid's Bun plugin for JSX transform.
// The plugin uses babel-preset-solid to transform JSX into solid-js reactive calls.
// This replaces `--jsx-runtime automatic --jsx-import-source @opentui/solid` CLI flags
// because @opentui/solid/jsx-runtime has no JS implementation — only types.
//
// @opentui/* are declared as optional peerDependencies. However, since
// package.json exports "./tui", a successful TUI build is required for the
// subpath to work. If @opentui/solid is absent, fail with a clear error
// rather than silently skipping and shipping a broken export subpath.
let solidPlugin: unknown
try {
  solidPlugin = (await import("@opentui/solid/bun-plugin")).default
} catch {
  console.error("[build:tui] @opentui/solid is not available, but package.json exports ./tui so TUI build cannot be skipped. Install @opentui/solid as a dependency.")
  process.exit(1)
}

const result = await Bun.build({
  entrypoints: ["src/tui/index.tsx"],
  outdir: "dist/tui",
  target: "bun",
  format: "esm",
  plugins: [solidPlugin as never],
  external: [
    "@opencode-ai/plugin",
    "@opencode-ai/sdk",
    "@opentui/core",
    "@opentui/solid",
    "solid-js",
  ],
})

if (!result.success) {
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log("✓ TUI entry built: dist/tui/index.js")

const tsc = Bun.spawn(["bunx", "tsc", "-p", "src/tui/tsconfig.json", "--emitDeclarationOnly"], {
  stdout: "inherit",
  stderr: "inherit",
})
const tscExit = await tsc.exited
if (tscExit !== 0) {
  console.error(`[build:tui] tsc emit for src/tui failed (exit ${tscExit})`)
  process.exit(tscExit)
}
console.log("✓ TUI type declarations emitted: dist/tui/*.d.ts")

export {}
