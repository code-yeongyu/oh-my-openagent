#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PINNED_SHA = "653a6af13812c55b2da6c49e982e0dcf16406d51";
const ARCHIVE_PATHS = [
  "packages/coding-agent",
  "packages/agent",
  "packages/ai",
  "packages/tui",
  "tsconfig.base.json",
  "scripts/prepare-senpi-bundled-workspaces.mjs",
];
const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const repoRoot = resolve(packageRoot, "..", "..");
const vendorRoot = join(packageRoot, "vendor");
const patchesRoot = join(packageRoot, "patches");
const shaPath = join(vendorRoot, "SENPI_SHA");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `\n${detail}` : ""}`);
  }
  return result.stdout ?? "";
}

function tryRun(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
}

async function readPinnedSha() {
  if (!existsSync(shaPath)) {
    return PINNED_SHA;
  }
  const sha = (await readFile(shaPath, "utf8")).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`Invalid SENPI_SHA: ${shaPath}`);
  }
  if (sha !== PINNED_SHA) {
    throw new Error(`Unexpected SENPI_SHA ${sha}; expected ${PINNED_SHA}`);
  }
  return sha;
}

function ensureSenpiCommit(senpiSrc, sha) {
  const local = tryRun("git", ["-C", senpiSrc, "cat-file", "-e", `${sha}^{commit}`]);
  if (local.status === 0) {
    console.error(`Using local senpi object ${sha}`);
    return;
  }
  console.error(`Pinned senpi object missing locally; fetching origin once in ${senpiSrc}`);
  run("git", ["-C", senpiSrc, "fetch", "origin"], { stdio: "inherit" });
  const afterFetch = tryRun("git", ["-C", senpiSrc, "cat-file", "-e", `${sha}^{commit}`]);
  if (afterFetch.status !== 0) {
    throw new Error(`Pinned senpi commit ${sha} is unavailable after fetch`);
  }
}

async function copyFiltered(src, dest) {
  const info = await stat(src);
  if (info.isSymbolicLink()) {
    const target = await readFile(src, "utf8");
    await symlink(target, dest);
    return;
  }
  if (info.isDirectory()) {
    await mkdir(dest, { recursive: true });
    for (const entry of await readdir(src, { withFileTypes: true })) {
      const childSrc = join(src, entry.name);
      const childDest = join(dest, entry.name);
      if (shouldExclude(relative(src, childSrc), entry.name, entry.isDirectory())) {
        continue;
      }
      await copyFiltered(childSrc, childDest);
    }
    return;
  }
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  await chmod(dest, info.mode);
}

function shouldExclude(rel, name, isDirectory) {
  const parts = rel.split(sep).filter(Boolean);
  if (isDirectory && ["node_modules", "dist", "test", "docs", "examples"].includes(name)) {
    return true;
  }
  if (parts.includes("node_modules") || parts.includes("dist") || parts.includes("test")) {
    return true;
  }
  if (parts.includes("docs") || parts.includes("examples")) {
    return true;
  }
  return name.endsWith(".test.ts") || /^vitest\.config\./.test(name);
}

async function writeToolchain(senpiSrc, sha, targetDir) {
  const rootPackage = JSON.parse(run("git", ["-C", senpiSrc, "show", `${sha}:package.json`]));
  const toolchain = {
    senpiSha: sha,
    packageName: rootPackage.name,
    engines: rootPackage.engines ?? {},
    devDependencies: rootPackage.devDependencies ?? {},
    dependencies: rootPackage.dependencies ?? {},
  };
  await writeFile(join(targetDir, "TOOLCHAIN.json"), `${JSON.stringify(toolchain, null, 2)}\n`);
}

async function extractArchive(senpiSrc, sha, targetDir) {
  const temp = await mkdtemp(join(tmpdir(), "omo-pi-senpi-archive-"));
  try {
    const tarPath = join(temp, "senpi.tar");
    const extracted = join(temp, "extracted");
    await mkdir(extracted, { recursive: true });
    run("git", ["-C", senpiSrc, "archive", "--format=tar", "--output", tarPath, sha, ...ARCHIVE_PATHS]);
    run("tar", ["-xf", tarPath, "-C", extracted]);
    await rm(targetDir, { recursive: true, force: true });
    await mkdir(join(targetDir, "scripts"), { recursive: true });
    await copyFile(join(extracted, "tsconfig.base.json"), join(targetDir, "tsconfig.base.json"));
    await copyFiltered(
      join(extracted, "scripts", "prepare-senpi-bundled-workspaces.mjs"),
      join(targetDir, "scripts", "prepare-senpi-bundled-workspaces.mjs"),
    );
    for (const name of ["coding-agent", "agent", "ai", "tui"]) {
      await copyFiltered(join(extracted, "packages", name), join(targetDir, name));
    }
    await writeFile(join(targetDir, "SENPI_SHA"), `${sha}\n`);
    await writeToolchain(senpiSrc, sha, targetDir);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function patchFiles() {
  if (!existsSync(patchesRoot)) return [];
  return (await readdir(patchesRoot))
    .filter((name) => name.endsWith(".patch"))
    .sort()
    .map((name) => join(patchesRoot, name));
}

async function applyPatches(targetDir) {
  const patches = await patchFiles();
  for (const patch of patches) {
    const directory = relative(repoRoot, targetDir);
    const result = tryRun("git", ["apply", `--directory=${directory}`, patch]);
    if (result.status !== 0) {
      const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
      throw new Error(`Failed to apply patch ${basename(patch)}${detail ? `\n${detail}` : ""}`);
    }
  }
}

async function listFiles(root, base = root) {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const full = join(root, entry.name);
    const rel = relative(base, full);
    if (isIgnoredBuildOutput(rel, entry.isDirectory())) {
      continue;
    }
    if (entry.isDirectory()) {
      paths.push(...(await listFiles(full, base)));
    } else if (entry.isFile()) {
      paths.push(rel);
    }
  }
  return paths.sort();
}

function isIgnoredBuildOutput(rel, isDirectory) {
  const parts = rel.split(sep).filter(Boolean);
  return isDirectory && (parts.includes("node_modules") || parts.includes("dist"));
}

async function compareTrees(expectedRoot, actualRoot) {
  const expected = await listFiles(expectedRoot);
  const actual = await listFiles(actualRoot);
  const all = [...new Set([...expected, ...actual])].sort();
  for (const rel of all) {
    if (!expected.includes(rel)) throw new Error(`Mismatch extra file: ${rel}`);
    if (!actual.includes(rel)) throw new Error(`Mismatch missing file: ${rel}`);
    const left = await readFile(join(expectedRoot, rel));
    const right = await readFile(join(actualRoot, rel));
    if (!left.equals(right)) throw new Error(`Mismatch changed file: ${rel}`);
  }
}

async function sync(targetDir = vendorRoot) {
  const senpiSrc = resolve(process.env.SENPI_SRC ?? "/Users/yeongyu/local-workspaces/senpi");
  const sha = await readPinnedSha();
  ensureSenpiCommit(senpiSrc, sha);
  await extractArchive(senpiSrc, sha, targetDir);
  await applyPatches(targetDir);
}

async function check() {
  const tempRoot = await mkdtemp(join(packageRoot, ".sync-check-"));
  try {
    const tempVendor = join(tempRoot, "vendor");
    await sync(tempVendor);
    await compareTrees(tempVendor, vendorRoot);
    console.log("SYNC-CLEAN");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args[0] && args[0] !== "--check")) {
    throw new Error("Usage: node packages/omo-pi/scripts/sync-senpi.mjs [--check]");
  }
  if (args[0] === "--check") {
    await check();
  } else {
    await sync();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
