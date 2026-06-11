#!/usr/bin/env bun
// Build the meta-governor plugin as ESM bundle + .d.ts declarations

const outDir = "dist"

// Clean
await $`rm -rf ${outDir}`
await $`mkdir -p ${outDir}`

// Build ESM bundle
await $`bun build src/index.ts --outdir=${outDir} --target=bun --format=esm --external=@opencode-ai/plugin --external=zod`

// Generate declarations
await $`tsc --emitDeclarationOnly --outDir ${outDir}`

console.log("[build] done: dist/index.js + dist/*.d.ts")
