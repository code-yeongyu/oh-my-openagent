import { build } from "esbuild"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const packageRoot = fileURLToPath(new URL(".", import.meta.url))

await build({
  entryPoints: [
    resolve(packageRoot, "src/index.ts")
  ],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node24",
  outfile: resolve(packageRoot, "dist/index.js"),
  external: [
    "@code-yeongyu/senpi",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-*",
    "typebox"
  ]
})
