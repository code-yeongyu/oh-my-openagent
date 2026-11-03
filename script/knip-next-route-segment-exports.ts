import { isAbsolute, relative, sep } from "node:path";
import type { Preprocessor } from "knip";

// Next.js reads route-segment config exports (revalidate, dynamic, generateMetadata, metadata, ...) by name from the
// special files of an app directory, so they are used by the framework, not dead. knip's Next.js plugin recognises them
// only by leaving every export of those files unchecked, which would also hide a genuinely unused export there (and
// would shrink the coverage script/knip-coverage.test.ts measures). This preprocessor instead drops exactly the names
// listed in knip.jsonc `preprocessorOptions.nextRouteSegmentExports`, and only for the special files of the configured
// app directory; every other export of those files, and every other file, stays checked.

type Scope = { dir: string; files: Set<string>; names: Set<string> };

// Next.js's default pageExtensions; .mjs and .cjs are not among them, so a file with one is not a route file.
const EXTENSIONS = ["js", "jsx", "ts", "tsx"];

const stringList = (value: unknown, key: string): string[] => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new Error(`knip preprocessorOptions.nextRouteSegmentExports.${key} must be a string list`);
  return value;
};

const scopes = (raw: string): Scope[] => {
  const options: unknown = raw === "" ? {} : JSON.parse(raw);
  const table =
    typeof options === "object" && options !== null && "nextRouteSegmentExports" in options
      ? options.nextRouteSegmentExports
      : undefined;
  if (table === undefined) return [];
  const entries = Array.isArray(table) ? table : [table];
  return entries.map((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
      throw new Error("knip preprocessorOptions.nextRouteSegmentExports must be an object or a list of objects");
    const dir = (entry as Record<string, unknown>)["dir"];
    if (typeof dir !== "string" || dir === "")
      throw new Error("knip preprocessorOptions.nextRouteSegmentExports.dir must be a non-empty string");
    return {
      dir: dir.endsWith("/") ? dir : `${dir}/`,
      files: new Set(stringList((entry as Record<string, unknown>)["files"], "files")),
      names: new Set(stringList((entry as Record<string, unknown>)["names"], "names")),
    };
  });
};

// A path segment starting with "_" is a Next.js private folder: it is opted out of routing, so a special file name
// under it is an ordinary module and its exports stay checked. The path given here is relative to the scope's dir.
const isPrivatePath = (path: string): boolean => path.split("/").slice(0, -1).some((segment) => segment.startsWith("_"));

// "packages/web/app/design/layout.tsx" -> "layout" when the extension is one knip reads, else undefined.
const specialFileName = (file: string): string | undefined => {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return EXTENSIONS.includes(base.slice(dot + 1)) ? base.slice(0, dot) : undefined;
};

const preprocess: Preprocessor = (options) => {
  const configured = scopes(options.preprocessorOptions);
  if (configured.length === 0) return options;
  const records = options.issues.exports;
  for (const [path, symbols] of Object.entries(records)) {
    const file = (isAbsolute(path) ? relative(options.cwd, path) : path).split(sep).join("/");
    const name = specialFileName(file);
    if (name === undefined) continue;
    const names = configured
      .filter((scope) => file.startsWith(scope.dir) && scope.files.has(name) && !isPrivatePath(file.slice(scope.dir.length)))
      .reduce<Set<string>>((all, scope) => {
        for (const allowed of scope.names) all.add(allowed);
        return all;
      }, new Set<string>());
    if (names.size === 0) continue;
    // Record keys can carry a namespace prefix ("daemon.CounterError"); the issue's symbol is the name.
    for (const [key, issue] of Object.entries(symbols)) {
      if (!names.has(issue.symbol)) continue;
      delete symbols[key];
      options.counters.exports -= 1;
    }
    if (Object.keys(symbols).length === 0) delete records[path];
  }
  return options;
};

export default preprocess;
