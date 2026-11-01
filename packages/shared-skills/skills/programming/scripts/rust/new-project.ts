#!/usr/bin/env bun
/**
 * Scaffold a new Rust project with strict lints, deny.toml, rustfmt.toml, and
 * rust-toolchain.toml pre-configured. The generated project passes its own
 * fmt + clippy gate before any code is written.
 *
 * ─── How to run ───
 * 1. Install Bun:  curl -fsSL https://bun.sh/install | bash
 * 2. Install Rust: https://rustup.rs (cargo >= 1.85, edition 2024)
 * 3. Run:
 *      bun run new-project.ts myproject
 *      bun run new-project.ts myproject --path ./workspace
 * ──────────────────
 *
 * Exit codes: 0 created, 1 cargo or scaffold failure, 2 usage error.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { assertNever, runTool } from "../shared/run-tool.ts";

const USAGE = `Usage: bun run new-project.ts <name> [--path <dir>]

Arguments:
  name          Name of the new Rust project

Options:
  -p, --path    Parent directory where the project folder is created (default: cwd)
  -h, --help    Show this help`;

const RUST_TOOLCHAIN_TOML = `[toolchain]
channel = "stable"
components = ["rustfmt", "clippy", "rust-src"]
profile = "default"
`;

const CARGO_TOML_LINTS = `
[lints.rust]
unsafe_op_in_unsafe_fn = "deny"
missing_docs = "warn"
missing_debug_implementations = "warn"
unreachable_pub = "warn"
unused_must_use = "deny"
elided_lifetimes_in_paths = "warn"
non_ascii_idents = "deny"
trivial_numeric_casts = "warn"
unused_lifetimes = "warn"
single_use_lifetimes = "warn"
unexpected_cfgs = { level = "deny", check-cfg = ["cfg(loom)"] }

[lints.clippy]
all = { level = "deny", priority = -1 }
pedantic = { level = "warn", priority = -1 }
nursery = { level = "warn", priority = -1 }
cargo = { level = "warn", priority = -1 }
undocumented_unsafe_blocks = "deny"
multiple_unsafe_ops_per_block = "deny"
unwrap_used = "deny"
expect_used = "deny"
panic = "deny"
todo = "deny"
unimplemented = "deny"
dbg_macro = "deny"
print_stdout = "warn"
print_stderr = "warn"
allow_attributes = "deny"
allow_attributes_without_reason = "deny"
let_underscore_must_use = "deny"
indexing_slicing = "deny"
mem_forget = "deny"
clone_on_ref_ptr = "warn"
module_name_repetitions = { level = "allow" }
must_use_candidate = { level = "allow" }
`;

const DENY_TOML = `[advisories]
yanked = "deny"

[licenses]
private = { ignore = true }  # publish = false crates carry no license field
allow = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Unicode-3.0", "Zlib"]

[bans]
multiple-versions = "warn"
wildcards = "deny"

[sources]
unknown-registry = "deny"
unknown-git = "deny"
`;

const MAIN_RS = `//! Command-line entry point.

use std::io::Write as _;

fn main() -> std::io::Result<()> {
    writeln!(std::io::stdout().lock(), "Hello, world!")
}
`;

const RUSTFMT_TOML = `edition = "2024"
max_width = 100
use_field_init_shorthand = true
use_try_shorthand = true
`;

const EDITION_LINE = 'edition = "2024"\n';

type ProjectOptions = { readonly name: string; readonly path: string };

type Cli =
  | { readonly kind: "run"; readonly options: ProjectOptions }
  | { readonly kind: "help" }
  | { readonly kind: "usage"; readonly problem: string };

class ScaffoldError extends Error {
  constructor(
    readonly kind: "cargo-unavailable" | "cargo-init-failed" | "edition-too-old",
    message: string,
  ) {
    super(message);
    this.name = "ScaffoldError";
  }
}

function parseCli(): Cli {
  try {
    const { values, positionals } = parseArgs({
      args: Bun.argv.slice(2),
      options: {
        path: { type: "string", short: "p", default: process.cwd() },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    if (values.help) return { kind: "help" };
    const [name, ...extra] = positionals;
    if (name === undefined || extra.length > 0) return { kind: "usage", problem: "expected exactly one project name" };
    return { kind: "run", options: { name, path: values.path } };
  } catch (error) {
    if (error instanceof TypeError) return { kind: "usage", problem: error.message };
    throw error;
  }
}

function cargoInit(projectDir: string, name: string): void {
  const init = runTool("cargo", ["init", projectDir, "--name", name]);
  switch (init.kind) {
    case "ok":
      return;
    case "unavailable":
      throw new ScaffoldError("cargo-unavailable", `cargo not found (${init.reason}). Install Rust via https://rustup.rs`);
    case "failed":
      throw new ScaffoldError("cargo-init-failed", `cargo init failed:\n${init.stderr}`);
    default:
      return assertNever(init);
  }
}

function scaffold({ name, path }: ProjectOptions): void {
  const projectDir = join(path, name);
  console.error(`Creating project ${name} at ${projectDir}`);
  cargoInit(projectDir, name);

  writeFileSync(join(projectDir, "rust-toolchain.toml"), RUST_TOOLCHAIN_TOML);
  console.error("  wrote rust-toolchain.toml");

  const cargoToml = join(projectDir, "Cargo.toml");
  const manifest = readFileSync(cargoToml, "utf8");
  if (!manifest.includes(EDITION_LINE)) {
    throw new ScaffoldError("edition-too-old", "cargo did not create an edition 2024 package; install Rust >= 1.85");
  }
  const withMsrv = manifest.replace(EDITION_LINE, `${EDITION_LINE}rust-version = "1.85"\npublish = false\n`);
  writeFileSync(cargoToml, withMsrv + CARGO_TOML_LINTS);
  writeFileSync(join(projectDir, "src", "main.rs"), MAIN_RS);
  console.error("  appended [lints] to Cargo.toml");

  writeFileSync(join(projectDir, "deny.toml"), DENY_TOML);
  console.error("  wrote deny.toml");

  writeFileSync(join(projectDir, "rustfmt.toml"), RUSTFMT_TOML);
  console.error("  wrote rustfmt.toml");

  console.error(`\nDone! cd ${projectDir} && cargo check`);
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
      break;
    default:
      return assertNever(cli);
  }
  try {
    scaffold(cli.options);
    return 0;
  } catch (error) {
    if (error instanceof ScaffoldError) {
      console.error(`Error: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

process.exit(main());
