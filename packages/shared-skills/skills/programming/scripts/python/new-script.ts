#!/usr/bin/env bun
/**
 * Generate a PEP 723 Python script with all boilerplate pre-filled: uv shebang,
 * inline metadata (requires-python + dependencies), the mandatory "How to run"
 * block, `from __future__ import annotations`, and a main() guard.
 *
 * ─── How to run ───
 * 1. Install Bun: curl -fsSL https://bun.sh/install | bash
 * 2. Run:
 *      bun run new-script.ts my_tool
 *      bun run new-script.ts my_tool --output ./scripts/my_tool.py
 *      bun run new-script.ts my_tool --deps 'httpx2[http2,brotli,zstd]' --deps rich --deps polars
 *      bun run new-script.ts my_tool --py 3.13
 * ──────────────────
 *
 * Writes to <os tmpdir>/uv-scripts/<name>.py unless --output is given.
 * Exit codes: 0 written, 2 usage error.
 */

import { chmodSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { assertNever } from "../shared/run-tool.ts";

const USAGE = `Usage: bun run new-script.ts <name> [--output <path>] [--deps <dep>]... [--py <version>]

Arguments:
  name          Script name (without .py extension)

Options:
  -o, --output  Output path (default: OS temp directory)
  -d, --deps    Dependency to include (repeat --deps for each)
  --py          Minimum Python version (default: 3.13)
  -h, --help    Show this help`;

type ScriptOptions = {
  readonly name: string;
  readonly output: string | undefined;
  readonly deps: readonly string[];
  readonly py: string;
};

type Cli =
  | { readonly kind: "run"; readonly options: ScriptOptions }
  | { readonly kind: "help" }
  | { readonly kind: "usage"; readonly problem: string };

function parseCli(): Cli {
  try {
    const { values, positionals } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        output: { type: "string", short: "o" },
        deps: { type: "string", short: "d", multiple: true, default: [] },
        py: { type: "string", default: "3.13" },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    if (values.help) return { kind: "help" };
    const [name, ...extra] = positionals;
    if (name === undefined || extra.length > 0) return { kind: "usage", problem: "expected exactly one script name" };
    return { kind: "run", options: { name, output: values.output, deps: values.deps, py: values.py } };
  } catch (error) {
    if (error instanceof TypeError) return { kind: "usage", problem: error.message };
    throw error;
  }
}

function renderScript(pythonVersion: string, deps: readonly string[], filename: string): string {
  const depsBlock =
    deps.length > 0
      ? deps.map((dep) => `#     "${dep}",\n`).join("")
      : '#     # add deps here, e.g.: "httpx2[http2,brotli,zstd]"\n';
  const argsHint = "";
  return `#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=${pythonVersion}"
# dependencies = [
${depsBlock}# ]
# ///

# ─── How to run ───
# 1. Install uv (if not installed):
#      curl -LsSf https://astral.sh/uv/install.sh | sh
# 2. Run directly (no venv, no pip install needed):
#      uv run ${filename} ${argsHint}
# 3. Or make executable and run:
#      chmod +x ${filename} && ./${filename}
# ──────────────────

from __future__ import annotations


def main() -> None:
    """TODO: implement."""


if __name__ == "__main__":
    main()
`;
}

function writeScript({ name, output, deps, py }: ScriptOptions): void {
  const filename = name.endsWith(".py") ? name : `${name}.py`;
  const dest = output ?? join(tmpdir(), "uv-scripts", filename);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, renderScript(py, deps, filename));
  if (process.platform !== "win32") chmodSync(dest, statSync(dest).mode | 0o111);

  console.log(`✓ Created: ${dest}`);
  console.log(`  Run: uv run ${dest}`);
}

function main(): number {
  const cli = parseCli();
  switch (cli.kind) {
    case "help":
      console.log(USAGE);
      return 0;
    case "usage":
      console.error(`Error: ${cli.problem}\n\n${USAGE}`);
      return 2;
    case "run":
      writeScript(cli.options);
      return 0;
    default:
      return assertNever(cli);
  }
}

process.exit(main());
