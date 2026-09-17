import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Shared argv parser for dag QA drivers. Accepts either:
 *   <script> <dir>
 *   <script> --out-dir <dir>
 * and refuses unknown flags or extra positionals so a bare `--out-dir`
 * cannot accidentally become a directory name (see #8406).
 */
export function resolveOutDir(defaultName: string): string {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    return join(tmpdir(), defaultName)
  }

  if (args.length === 1 && !args[0].startsWith("-")) {
    return args[0]
  }

  if (args.length === 2 && args[0] === "--out-dir" && !args[1].startsWith("-")) {
    return args[1]
  }

  const script = process.argv[1]?.split("/").pop() ?? "qa-script"
  throw new Error(
    `Usage: bun ${script} [<dir> | --out-dir <dir>]\n` +
      `  <dir>            Output directory for the QA report\n` +
      `  --out-dir <dir>  Same, flag form\n` +
      `\nReceived: ${args.map((a) => JSON.stringify(a)).join(" ")}`,
  )
}
