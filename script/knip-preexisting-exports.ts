import { isAbsolute, relative, sep } from "node:path";
import type { Preprocessor } from "knip";

// knip has no per-symbol ignore: an `ignoreIssues` entry silences every export of a file, so a new
// unused export there would pass `knip:check`. This preprocessor drops only the unused exports named
// in knip.jsonc `preprocessorOptions.preExistingExports` ({ "<file>": ["<name>", ...] }); every
// other export of those files stays checked. scripts/knip-coverage.test.ts fails when a listed name
// is no longer reported, so the list cannot go stale.

const preExisting = (raw: string): Map<string, Set<string>> => {
  const options: unknown = raw === "" ? {} : JSON.parse(raw);
  const table =
    typeof options === "object" && options !== null && "preExistingExports" in options
      ? options.preExistingExports
      : {};
  if (typeof table !== "object" || table === null || Array.isArray(table))
    throw new Error("knip preprocessorOptions.preExistingExports must be an object");
  const allowed = new Map<string, Set<string>>();
  for (const [file, names] of Object.entries(table)) {
    if (!Array.isArray(names) || !names.every((name) => typeof name === "string"))
      throw new Error(
        `knip preprocessorOptions.preExistingExports["${file}"] must be a string list`,
      );
    allowed.set(file, new Set(names));
  }
  return allowed;
};

const preprocess: Preprocessor = (options) => {
  const allowed = preExisting(options.preprocessorOptions);
  const records = options.issues.exports;
  for (const [path, symbols] of Object.entries(records)) {
    const file = (isAbsolute(path) ? relative(options.cwd, path) : path).split(sep).join("/");
    const names = allowed.get(file);
    if (names === undefined) continue;
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
