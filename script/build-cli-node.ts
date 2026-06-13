import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// jsonc-parser has no exports map and its node-resolved "main" is a UMD build whose
// inner relative requires survive bundling and crash under plain node, while the
// published payloads ship no node_modules for an external to resolve from
// (lazycodex#47 review). Bundle the ESM entry inline instead.
const jsoncParserEsmEntry = fileURLToPath(new URL("../node_modules/jsonc-parser/lib/esm/main.js", import.meta.url));

const result = await Bun.build({
  entrypoints: [`${repoRoot}packages/omo-opencode/src/cli/index.ts`],
  outdir: `${repoRoot}dist/cli-node`,
  target: "node",
  format: "esm",
  external: ["@ast-grep/napi"],
  plugins: [
    {
      name: "jsonc-parser-esm",
      setup(build) {
        build.onResolve({ filter: /^jsonc-parser$/ }, () => ({ path: jsoncParserEsmEntry }));
      },
    },
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(`built dist/cli-node (${result.outputs.length} output${result.outputs.length === 1 ? "" : "s"})`);
