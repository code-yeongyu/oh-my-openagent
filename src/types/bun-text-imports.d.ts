// Project-local ambient type for Bun text imports of file extensions
// not covered by `bun-types/extensions.d.ts` (which declares .txt/.toml/
// .yaml/.yml/.jsonc/.json5/.html but omits .py).
//
// `import script from "./foo.py" with { type: "text" }` returns the
// file contents as a string at module load (bundle) time.
declare module "*.py" {
  const contents: string
  export default contents
}
