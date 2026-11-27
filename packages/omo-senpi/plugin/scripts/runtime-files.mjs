import { join } from "node:path"

// The SDK root's runtime files (slice P1c, #15031), one row each. The build, its externals, the build stamp, the freshness
// check, the installer's required list, the byte ceilings and the kept-list checks all read this table, so a lazily
// loaded file is one row here and nowhere else by hand. `entry` is relative to the omo-senpi package, `output` to the
// plugin root; `specifier` is the import-map name both manifests map (the source package to the entry, the shipped plugin
// to the output). `lazy` marks a file the root loads on first use. `ceiling` is the file's byte budget, measured with bun
// 1.4.4 and node 24.22.0 on a frozen install; `staticSet` names its committed kept-module list in plugin/scripts;
// `packages` is the exact set of node packages the file inlines, by name, so an import that widens it fails naming it.
export const SDK_RUNTIME_FILES = [
  {
    name: "root",
    entry: "src/extension/omo-sdk.ts",
    output: "runtime/omo-sdk/sdk.js",
    specifier: "#omo-sdk",
    lazy: false,
    ceiling: 612_539,
    staticSet: "omo-sdk-static-modules.json",
    packages: ["jsonc-parser", "typebox", "zod"],
  },
  {
    name: "threads",
    entry: "src/components/thread/sdk-core/runtime-entry.ts",
    output: "runtime/omo-sdk/threads.js",
    specifier: "#omo-sdk-threads-runtime",
    lazy: true,
    ceiling: 246_730,
    staticSet: "omo-sdk-threads-static-modules.json",
    packages: ["typebox"],
  },
]

export const runtimeArtifactPaths = (table = SDK_RUNTIME_FILES) => table.map((row) => join(...row.output.split("/")))

// The plugin manifest whose import map resolves every row's specifier: the installer requires it like the files, because
// without it bun resolves a specifier through a manifest above the package (security review 6075906719, L3).
export const RUNTIME_IMPORT_MAP = "package.json"

/** Every row's output under one plugin output root, by row name. */
export const sdkRuntimeOutputPaths = (root, table = SDK_RUNTIME_FILES) =>
  Object.fromEntries(table.map((row) => [row.name, join(root, ...row.output.split("/"))]))
