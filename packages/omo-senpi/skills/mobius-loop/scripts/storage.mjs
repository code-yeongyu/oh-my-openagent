import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { MobiusError, requireValue, shape, object, event } from "./validation.mjs";
import { derive } from "./records.mjs";

/** @param {unknown} error @param {string} code */
export function hasCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

/** @param {string} path */
async function inspect(path) {
  try {
    const stat = await lstat(path);
    requireValue(!stat.isSymbolicLink(), `Symlinked storage is forbidden: ${path}`, "UNSAFE_PATH");
    return stat;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}

/** @param {unknown} input @param {boolean} create */
export async function location(input, create) {
  shape(input, { cwd: "string", slug: "string" });
  object(input);
  requireValue(typeof input.cwd === "string" && typeof input.slug === "string", "cwd and slug are required");
  requireValue(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug) && input.slug.length <= 80,
    "Slug must use lowercase letters, digits, and single hyphens", "UNSAFE_PATH");
  const cwd = await realpath(resolve(input.cwd));
  requireValue(cwd !== await realpath(homedir()), "HOME cannot be used as a project", "UNSAFE_PATH");
  const project = await lstat(cwd);
  requireValue(project.isDirectory(), "cwd must be a project directory", "UNSAFE_PATH");
  let directory = cwd;
  for (const segment of [".omo", "mobius", input.slug]) {
    directory = join(directory, segment);
    let stat = await inspect(directory);
    if (!stat && create) {
      try { await mkdir(directory); }
      catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
      stat = await inspect(directory);
    }
    if (!stat) throw new MobiusError("NOT_FOUND", "Initiative has not been started");
    requireValue(stat.isDirectory(), `Storage must be a directory: ${directory}`, "UNSAFE_PATH");
  }
  await inspect(join(directory, "initiative.json"));
  await inspect(join(directory, ".lock"));
  await inspect(join(directory, ".gitignore"));
  return { directory, slug: input.slug, file: join(directory, "initiative.json") };
}

/** @param {unknown} value @returns {asserts value is import('./contracts.d.mts').Snapshot} */
function snapshot(value) {
  shape(value, { schemaVersion: "revision", slug: "string", title: "string", initialFocus: "discover|decide|deliver",
    revision: "revision", events: { array: { object: { revision: "revision", at: "string", event: { object: {} } } } } });
}

/** @param {{file: string, slug: string}} store @returns {Promise<import('./contracts.d.mts').Snapshot | null>} */
export async function load(store) {
  let handle;
  try {
    handle = await open(store.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    requireValue((await handle.stat()).isFile(), "State must be a regular file", "MALFORMED_STATE");
    /** @type {unknown} */
    const value = JSON.parse(await handle.readFile("utf8"));
    object(value);
    const history = value.events;
    requireValue(Array.isArray(history), "State history must be an array");
    const header = { ...value, events: [] };
    snapshot(header);
    requireValue(header.schemaVersion === 1 && header.slug === store.slug && header.revision === history.length,
      "State version, identity, or revision is inconsistent");
    for (const [index, entry] of history.entries()) {
      object(entry);
      requireValue(Object.keys(entry).length === 3 && entry.revision === index + 1
        && typeof entry.at === "string" && Number.isFinite(Date.parse(entry.at)), "Invalid event history");
      event(entry.event);
      header.events.push({ revision: index + 1, at: entry.at, event: entry.event });
    }
    derive(header);
    return header;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    if (hasCode(error, "ELOOP")) throw new MobiusError("UNSAFE_PATH", "Symlinked state is forbidden");
    if (error instanceof SyntaxError || error instanceof MobiusError)
      throw new MobiusError("MALFORMED_STATE", `Refusing malformed state: ${error.message}`);
    throw error;
  } finally { await handle?.close(); }
}

/** @template T @param {unknown} input @param {boolean} create @param {(store: {directory: string, slug: string, file: string}) => Promise<T>} action */
export async function locked(input, create, action) {
  const store = await location(input, create);
  const lock = join(store.directory, ".lock");
  try { await mkdir(lock); }
  catch (error) {
    if (hasCode(error, "EEXIST")) throw new MobiusError("BUSY", "Another writer holds the initiative lock");
    throw error;
  }
  try {
    await location(input, false);
    return await action(store);
  } finally { await rmdir(lock); }
}

/** @param {{directory: string, file: string}} store @param {import('./contracts.d.mts').Snapshot} value */
export async function save(store, value) {
  const temporary = join(store.directory, `.initiative-${randomUUID()}.tmp`);
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let moved = false;
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    await inspect(store.file);
    await rename(temporary, store.file);
    moved = true;
    // Windows cannot flush a directory opened without write access.
    if (process.platform !== "win32") {
      const directory = await open(store.directory, constants.O_RDONLY);
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } finally {
    await handle.close();
    if (!moved) await unlink(temporary);
  }
}

/** @param {{directory: string}} store */
export async function ignoreGenerated(store) {
  const file = join(store.directory, ".gitignore");
  let handle;
  try {
    handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile("*\n");
    await handle.sync();
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
    const existing = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { requireValue((await existing.readFile("utf8")).split("\n").includes("*"), "Generated store must ignore its subtree", "UNSAFE_PATH"); }
    finally { await existing.close(); }
  } finally { await handle?.close(); }
}
