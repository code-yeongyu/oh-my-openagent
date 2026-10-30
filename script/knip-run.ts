import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";
import { Glob } from "bun";

// realpathSync.native: the JS realpathSync keeps Windows 8.3 short names (C:\Users\RUNNER~1), while knip's resolver
// returns the long form for files it reaches through imports, so the two forms of one root would not match.
export const REPO_ROOT = realpathSync.native(join(import.meta.dir, ".."));

// One path form on every platform: POSIX separators, relative to `root` when `path` is absolute.
export const toRepoPath = (root: string, path: string): string => {
  const style = /^[A-Za-z]:[\\/]/.test(path) || path.includes("\\") ? win32 : posix;
  return (style.isAbsolute(path) ? style.relative(root, path) : path).split(win32.sep).join(posix.sep);
};

// knip --debug logs each glob it expands as util.inspect output: a "[<workspace>] Finding entry paths ..." line, then an object
// whose `paths` array lists the resolved files. A path can itself contain "]" (Next.js app/[locale]/page.tsx), so the array is
// read as a run of quoted strings up to its own closing bracket; an array that is not one (a truncated or re-quoted listing)
// fails instead of silently dropping the rest of the section. Returns one path list per section.
const ENTRY_SECTION = /^\[[^\]\n]*\] Finding entry paths/m;
const NEXT_SECTION = /^\[[^\]\n]*\] /m;
const QUOTED = String.raw`'(?:[^'\\]|\\.)*'`;
const PATHS_ARRAY = new RegExp(String.raw`paths: \[((?:\s*${QUOTED},?)*)\s*\]`, "y");
export const debugEntryPaths = (stdout: string): string[][] =>
  stdout
    .split(ENTRY_SECTION)
    .slice(1)
    .map((chunk) => {
      // Read only this section's own first array: a missing or unreadable one must not fall through to a later listing.
      const end = chunk.search(NEXT_SECTION);
      const section = end < 0 ? chunk : chunk.slice(0, end);
      const start = section.indexOf("paths: [");
      PATHS_ARRAY.lastIndex = start;
      const listing = start < 0 ? undefined : PATHS_ARRAY.exec(section)?.[1];
      if (listing === undefined) throw new Error(`knip --debug printed an entry section with no readable paths array:\n${section.slice(0, 2000)}`);
      return [...listing.matchAll(new RegExp(QUOTED, "g"))].map(([quoted]) => quoted.slice(1, -1).replace(/\\(.)/g, "$1"));
    });

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const runKnip = async (cwd: string, args: string[]) => {
  const proc = Bun.spawn([process.execPath, "run", "knip:check", ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { stdout, stderr, code: await proc.exited };
};

// Tracked plus untracked-but-not-gitignored files: what knip can see. Gitignored build output (dist/) is never an entry.
export const repoFiles = (): string[] =>
  execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: REPO_ROOT, maxBuffer: 256 << 20 })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);

export const knipConfig = async (): Promise<Record<string, unknown>> => {
  const config: unknown = Bun.JSONC.parse(await Bun.file(join(REPO_ROOT, "knip.jsonc")).text());
  if (!isObject(config)) throw new Error("knip.jsonc is not an object");
  return config;
};

export const packageDirs = async (): Promise<string[]> => {
  const rootPkg: unknown = await Bun.file(join(REPO_ROOT, "package.json")).json();
  const patterns = isObject(rootPkg) && Array.isArray(rootPkg["workspaces"]) ? rootPkg["workspaces"] : [];
  const config = await knipConfig();
  const configured = isObject(config["workspaces"]) ? Object.keys(config["workspaces"]) : [];
  const dirs = new Set(["."]);
  for (const pattern of [...patterns, ...configured])
    if (typeof pattern === "string" && pattern !== ".")
      // Glob.scan yields native separators (packages\x\package.json on Windows); posix.dirname of that is ".", which would
      // drop every package dir and leave the probe copies without their isolated node_modules links.
      for await (const pkg of new Glob(`${pattern}/package.json`).scan({ cwd: REPO_ROOT }))
        dirs.add(posix.dirname(toRepoPath(REPO_ROOT, pkg)));
  return [...dirs];
};

// A temp copy of the files knip can see, with each package's node_modules linked. The caller removes it.
// realpath: on macOS tmpdir() and /tmp are symlinks into /private, and on Windows tmpdir() can be an 8.3 short
// name (C:\Users\RUNNER~1); knip misses probes under either form, so the copy root is the native realpath.
export const copyRepo = async (): Promise<string> => {
  const copy = realpathSync.native(mkdtempSync(join(tmpdir(), "knip-probe-")));
  for (const file of repoFiles()) {
    const src = join(REPO_ROOT, file);
    if (!existsSync(src) || lstatSync(src).isDirectory()) continue;
    mkdirSync(dirname(join(copy, file)), { recursive: true });
    cpSync(src, join(copy, file), { verbatimSymlinks: true });
  }
  for (const dir of await packageDirs()) {
    const modules = join(REPO_ROOT, dir, "node_modules");
    if (existsSync(modules) && existsSync(join(copy, dir)) && !existsSync(join(copy, dir, "node_modules")))
      symlinkSync(modules, join(copy, dir, "node_modules"), "dir");
  }
  return copy;
};

// Keys are `<repo-relative POSIX path>#<export name>`; a reported path outside `cwd` is an error, never a silent miss.
export const unusedExports = (cwd: string, stdout: string, stderr: string): Set<string> => {
  const start = stdout.indexOf("{");
  if (start < 0) throw new Error(`knip printed no JSON report:\n${stderr.slice(0, 4000)}`);
  const report: unknown = JSON.parse(stdout.slice(start));
  const issues = isObject(report) && Array.isArray(report["issues"]) ? report["issues"] : [];
  const unused = new Set<string>();
  for (const issue of issues) {
    if (!isObject(issue) || typeof issue["file"] !== "string" || !Array.isArray(issue["exports"])) continue;
    const file = toRepoPath(cwd, issue["file"]);
    if (file.startsWith("../") || posix.isAbsolute(file) || win32.isAbsolute(file))
      throw new Error(`knip reported ${issue["file"]}, outside its cwd ${cwd}`);
    for (const item of issue["exports"])
      if (isObject(item) && typeof item["name"] === "string") unused.add(`${file}#${item["name"]}`);
  }
  return unused;
};
