import { join } from "node:path"

// The SDK root's runtime files (slice P1c, #15031), one row each. The build, its externals, the freshness check and the
// installer's required list all read this table, so a lazily loaded file is one row here and nowhere else by hand. `entry`
// is relative to the omo-senpi package, `output` to the plugin root; `specifier` is the import-map name both manifests map
// (the source package to the entry, the shipped plugin to the output). `lazy` marks a file the root loads on first use.
export const SDK_RUNTIME_FILES = [
  {
    name: "root",
    entry: "src/extension/omo-sdk.ts",
    output: "runtime/omo-sdk/sdk.js",
    specifier: "#omo-sdk",
    lazy: false,
  },
  {
    name: "threads",
    entry: "src/components/thread/sdk-core/runtime-entry.ts",
    output: "runtime/omo-sdk/threads.js",
    specifier: "#omo-sdk-threads-runtime",
    lazy: true,
  },
]

export const runtimeArtifactPaths = (table = SDK_RUNTIME_FILES) => table.map((row) => join(...row.output.split("/")))
