#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// components/codegraph/src/cli.ts
import { realpathSync as realpathSync9 } from "node:fs";
import { basename as basename7, resolve as resolve10 } from "node:path";
import { stderr as processStderr5 } from "node:process";
import { fileURLToPath as fileURLToPath4 } from "node:url";

// components/codegraph/src/hook.ts
import {
  cwd as processCwd2,
  env as processEnv5,
  stderr as processStderr3,
  stdin as processStdin2,
  stdout as processStdout2
} from "node:process";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// ../../utils/src/codegraph/env.ts
import { homedir } from "node:os";
import { join } from "node:path";
var CODEGRAPH_INSTALL_DIR_ENV = "CODEGRAPH_INSTALL_DIR";
var CODEGRAPH_NO_DAEMON_ENV = "CODEGRAPH_NO_DAEMON";
var CODEGRAPH_NO_DOWNLOAD_ENV = "CODEGRAPH_NO_DOWNLOAD";
var CODEGRAPH_TELEMETRY_ENV = "CODEGRAPH_TELEMETRY";
var DO_NOT_TRACK_ENV = "DO_NOT_TRACK";
var SAFE_AMBIENT_ENV_KEYS = new Set([
  "APPDATA",
  "CI",
  "CODEX_HOME",
  "ComSpec",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "Path",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME"
]);
var SAFE_CODEGRAPH_RUNTIME_ENV_KEYS = new Set([
  "CODEGRAPH_ALLOW_UNSAFE_NODE",
  "CODEGRAPH_BIN",
  "CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS",
  "CODEGRAPH_FAKE_LOG",
  "CODEGRAPH_NO_DAEMON",
  "CODEGRAPH_NODE_BIN",
  "OMO_CODEGRAPH_BIN",
  "OMO_CODEGRAPH_PROJECT_CWD",
  "OMO_CODEGRAPH_SESSION_START_CWD"
]);
function buildCodegraphEnv(options = {}) {
  const homeDir = options.homeDir ?? homedir();
  return {
    [CODEGRAPH_INSTALL_DIR_ENV]: join(homeDir, ".omo", "codegraph"),
    ...options.daemon === false ? { [CODEGRAPH_NO_DAEMON_ENV]: "1" } : {},
    [CODEGRAPH_NO_DOWNLOAD_ENV]: "1",
    [CODEGRAPH_TELEMETRY_ENV]: "0",
    [DO_NOT_TRACK_ENV]: "1"
  };
}
function copyDefinedEnvKeys(output, input, allowedKeys) {
  for (const key of allowedKeys) {
    const value = input[key];
    if (value !== undefined)
      output[key] = value;
  }
}
function copyDefinedEnv(output, input) {
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined)
      output[key] = value;
  }
}
function buildCodegraphChildEnv(options = {}) {
  const env = {};
  copyDefinedEnvKeys(env, options.ambientEnv ?? {}, SAFE_AMBIENT_ENV_KEYS);
  copyDefinedEnvKeys(env, options.runtimeEnv ?? {}, SAFE_CODEGRAPH_RUNTIME_ENV_KEYS);
  copyDefinedEnv(env, options.codegraphEnv ?? {});
  return env;
}

// ../../utils/src/codegraph/workspace.ts
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync as existsSync2, lstatSync as lstatSync2, mkdirSync, realpathSync as realpathSync3, readFileSync as readFileSync2, statSync, symlinkSync } from "node:fs";
import { dirname, join as join5, resolve as resolve3 } from "node:path";

// ../../utils/src/codegraph/paths.ts
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { basename, join as join2, resolve } from "node:path";
function sanitizeBase(value) {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-");
  return sanitized.length > 0 ? sanitized : "workspace";
}
function codegraphDataRoot(homeDir) {
  return join2(homeDir, ".omo", "codegraph");
}
function canonicalizeCodegraphPath(path) {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch (error) {
    if (error instanceof Error)
      return resolved;
    throw error;
  }
}
function workspaceStorageName(workspace) {
  const resolved = canonicalizeCodegraphPath(workspace);
  const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 16);
  return `${sanitizeBase(basename(resolved))}-${hash}`;
}
function resolveCodegraphWorkspacePaths(workspace, options = {}) {
  const resolvedWorkspace = canonicalizeCodegraphPath(workspace);
  const dataRoot = codegraphDataRoot(options.homeDir ?? homedir2());
  return {
    dataDir: join2(dataRoot, "projects", workspaceStorageName(resolvedWorkspace)),
    dataRoot,
    projectLink: join2(resolvedWorkspace, ".codegraph")
  };
}

// ../../utils/src/codegraph/store.ts
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { join as join3 } from "node:path";
var CODEGRAPH_PROJECT_SOURCE_METADATA_FILE = "source.json";
var CODEGRAPH_PROJECT_SOURCE_METADATA_VERSION = 1;
function writeCodegraphSourceMetadata(dataDir, sourceDir) {
  writeFileSync(join3(dataDir, CODEGRAPH_PROJECT_SOURCE_METADATA_FILE), `${JSON.stringify({ sourceDir, version: CODEGRAPH_PROJECT_SOURCE_METADATA_VERSION }, null, 2)}
`);
}
function readRecordedSourceDir(projectDir) {
  const metadataPath = join3(projectDir, CODEGRAPH_PROJECT_SOURCE_METADATA_FILE);
  if (!existsSync(metadataPath))
    return null;
  try {
    const parsed = JSON.parse(readFileSync(metadataPath, "utf8"));
    if (typeof parsed !== "object" || parsed === null)
      return null;
    const sourceDir = parsed.sourceDir;
    return typeof sourceDir === "string" && sourceDir.trim().length > 0 ? sourceDir : null;
  } catch (error) {
    if (isNonFatalSourceMetadataError(error))
      return null;
    throw error;
  }
}
function isNonFatalSourceMetadataError(error) {
  if (error instanceof SyntaxError)
    return true;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return typeof code === "string" && ["EACCES", "ENOENT", "ENOTDIR", "EPERM"].includes(code);
}
function recordedSourceIsMissing(projectDir) {
  const sourceDir = readRecordedSourceDir(projectDir);
  return sourceDir !== null && !existsSync(sourceDir);
}
function pruneDeadCodegraphProjectStores(options = {}) {
  const projectsDir = join3(codegraphDataRoot(options.homeDir ?? homedir3()), "projects");
  const removed = [];
  if (!existsSync(projectsDir))
    return { remainingBytes: 0, removed };
  for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory())
      continue;
    const projectDir = join3(projectsDir, entry.name);
    if (!recordedSourceIsMissing(projectDir))
      continue;
    rmSync(projectDir, { force: true, recursive: true });
    removed.push(projectDir);
  }
  return { remainingBytes: 0, removed };
}

// ../../utils/src/codegraph/exclusion.ts
import { realpathSync as realpathSync2 } from "node:fs";
import { homedir as homedir4, tmpdir as osTmpdir } from "node:os";
import { isAbsolute, join as join4, resolve as resolve2 } from "node:path";
var POSIX_DEFAULT_EXCLUDED_ROOTS = ["/tmp", "/private/tmp"];
function expandHome(path, homeDir) {
  if (path === "~")
    return homeDir;
  if (path.startsWith("~/") || path.startsWith("~\\"))
    return join4(homeDir, path.slice(2));
  return path;
}
function realpathIfPossible(path) {
  try {
    return realpathSync2(path);
  } catch (error) {
    if (error instanceof Error)
      return resolve2(path);
    throw error;
  }
}
function resolveConfiguredRoot(path, homeDir) {
  const expanded = expandHome(path, homeDir);
  return realpathIfPossible(isAbsolute(expanded) ? expanded : join4(homeDir, expanded));
}
function normalizeForComparison(path, platform) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}
function pathIsWithin(path, root, platform) {
  const candidate = normalizeForComparison(path, platform);
  const normalizedRoot = normalizeForComparison(root, platform);
  return candidate === normalizedRoot || candidate.startsWith(`${normalizedRoot}/`);
}
function hasOmoPathSegment(path) {
  return path.split(/[\\/]+/).includes(".omo");
}
function defaultExcludedRoots(platform, tmpdir) {
  return platform === "win32" ? [tmpdir] : [...POSIX_DEFAULT_EXCLUDED_ROOTS, tmpdir];
}
function shouldExcludeCodegraphProject(workspace, options = {}) {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? homedir4();
  const tmpdir = options.tmpdir ?? osTmpdir();
  const resolvedWorkspace = realpathIfPossible(resolve2(workspace));
  if (hasOmoPathSegment(resolvedWorkspace)) {
    return { excluded: true, matchedRoot: ".omo", reason: "omo-state" };
  }
  for (const root of defaultExcludedRoots(platform, tmpdir)) {
    const resolvedRoot = realpathIfPossible(resolve2(root));
    if (pathIsWithin(resolvedWorkspace, resolvedRoot, platform)) {
      return { excluded: true, matchedRoot: root, reason: "tmp-root" };
    }
  }
  for (const root of options.excludedRoots ?? []) {
    const trimmedRoot = root.trim();
    if (trimmedRoot.length === 0)
      continue;
    const resolvedRoot = resolveConfiguredRoot(trimmedRoot, homeDir);
    if (pathIsWithin(resolvedWorkspace, resolvedRoot, platform)) {
      return { excluded: true, matchedRoot: root, reason: "custom-root" };
    }
  }
  return { excluded: false };
}

// ../../utils/src/codegraph/workspace.ts
function fallbackResult(dataRoot, projectLink, reason) {
  return { dataDir: projectLink, dataRoot, linked: false, mode: "in-place-fallback", projectLink, reason };
}
function isSameFilesystem(workspace, dataRoot, override) {
  if (override !== undefined)
    return override;
  return statSync(workspace).dev === statSync(dataRoot).dev;
}
function ensureInPlaceFallback(projectLink) {
  if (!existsSync2(projectLink))
    mkdirSync(projectLink, { recursive: true });
}
function prepareCodegraphWorkspace(workspace, options = {}) {
  const resolvedWorkspace = canonicalizeCodegraphPath(workspace);
  const { dataDir, dataRoot, projectLink } = resolveCodegraphWorkspacePaths(resolvedWorkspace, options);
  try {
    mkdirSync(dataDir, { recursive: true });
    writeCodegraphSourceMetadata(dataDir, resolvedWorkspace);
    if (existsSync2(projectLink)) {
      const linkStat = lstatSync2(projectLink);
      if (!linkStat.isSymbolicLink()) {
        return { dataDir: projectLink, dataRoot, linked: false, mode: "in-project", projectLink };
      }
      if (realpathSync3(projectLink) === realpathSync3(dataDir)) {
        return { dataDir, dataRoot, linked: true, mode: "global-linked", projectLink };
      }
      return fallbackResult(dataRoot, projectLink, "existing .codegraph symlink points outside OMO store");
    }
    if (!isSameFilesystem(resolvedWorkspace, dataRoot, options.sameFilesystem)) {
      ensureInPlaceFallback(projectLink);
      return fallbackResult(dataRoot, projectLink, "workspace and OMO store are on different filesystems");
    }
    const symlink = options.symlink ?? symlinkSync;
    symlink(dataDir, projectLink, (options.platform ?? process.platform) === "win32" ? "junction" : "dir");
    return { dataDir, dataRoot, linked: true, mode: "global-linked", projectLink };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try {
      ensureInPlaceFallback(projectLink);
    } catch (fallbackError) {
      const fallbackReason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      return fallbackResult(dataRoot, projectLink, `${reason}; fallback failed: ${fallbackReason}`);
    }
    return fallbackResult(dataRoot, projectLink, reason);
  }
}
function ensureCodegraphGitignored(workspace) {
  const gitMarkerPath = join5(workspace, ".git");
  if (!existsSync2(gitMarkerPath))
    return false;
  try {
    const isWorktree = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: workspace,
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      windowsHide: true
    }).trim();
    if (isWorktree !== "true")
      return false;
    const gitTopLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: workspace,
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      windowsHide: true
    }).trim();
    if (gitTopLevel.length === 0 || realpathSync3.native(gitTopLevel) !== realpathSync3.native(workspace))
      return false;
    const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: workspace,
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      windowsHide: true
    }).trim();
    if (gitDir.length === 0 || !gitMarkerOwnsGitDir(gitMarkerPath, workspace, gitDir))
      return false;
    const gitExcludePath = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], {
      cwd: workspace,
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      windowsHide: true
    }).trim();
    if (gitExcludePath.length === 0)
      return false;
    const excludePath = resolve3(workspace, gitExcludePath);
    mkdirSync(dirname(excludePath), { recursive: true });
    const existing = existsSync2(excludePath) ? readFileSync2(excludePath, "utf8") : "";
    if (existing.split(/\r?\n/).includes(".codegraph"))
      return true;
    appendFileSync(excludePath, `${existing.endsWith(`
`) || existing.length === 0 ? "" : `
`}.codegraph
`);
    return true;
  } catch {
    return false;
  }
}
function gitMarkerOwnsGitDir(gitMarkerPath, workspace, gitDir) {
  const markerStat = lstatSync2(gitMarkerPath);
  if (markerStat.isSymbolicLink())
    return false;
  const resolvedGitDir = realpathSync3.native(gitDir);
  if (markerStat.isDirectory())
    return realpathSync3.native(gitMarkerPath) === resolvedGitDir;
  if (!markerStat.isFile())
    return false;
  const markerMatch = /^gitdir:\s*(.+)\s*$/i.exec(readFileSync2(gitMarkerPath, "utf8").trim());
  if (markerMatch?.[1] === undefined)
    return false;
  if (realpathSync3.native(resolve3(workspace, markerMatch[1])) !== resolvedGitDir)
    return false;
  const backlinkPath = join5(resolvedGitDir, "gitdir");
  if (existsSync2(backlinkPath)) {
    const backlink = readFileSync2(backlinkPath, "utf8").trim();
    return backlink.length > 0 && realpathSync3.native(resolve3(resolvedGitDir, backlink)) === realpathSync3.native(gitMarkerPath);
  }
  const coreWorktree = execFileSync("git", ["config", "--file", join5(resolvedGitDir, "config"), "--get", "core.worktree"], {
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5000,
    windowsHide: true
  }).trim();
  return coreWorktree.length > 0 && realpathSync3.native(resolve3(resolvedGitDir, coreWorktree)) === realpathSync3.native(workspace);
}

// shared/src/config-loader.ts
import { homedir as homedir5 } from "node:os";

// ../../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/core.js
var _a;
function $constructor(name, initializer, params) {
  function init(inst, def) {
    if (!inst._zod) {
      Object.defineProperty(inst, "_zod", {
        value: {
          def,
          constr: _,
          traits: new Set
        },
        enumerable: false
      });
    }
    if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer(inst, def);
    const proto = _.prototype;
    const keys = Object.keys(proto);
    for (let i = 0;i < keys.length; i++) {
      const k = keys[i];
      if (!(k in inst)) {
        inst[k] = proto[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;

  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    var _a2;
    const inst = params?.Parent ? new Definition : this;
    init(inst, def);
    (_a2 = inst._zod).deferred ?? (_a2.deferred = []);
    for (const fn of inst._zod.deferred) {
      fn();
    }
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
var $brand = Symbol("zod_brand");

class $ZodAsyncError extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
}

class $ZodEncodeError extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
}
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}
// ../../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/util.js
var exports_util = {};
__export(exports_util, {
  BIGINT_FORMAT_RANGES: () => BIGINT_FORMAT_RANGES,
  Class: () => Class,
  NUMBER_FORMAT_RANGES: () => NUMBER_FORMAT_RANGES,
  aborted: () => aborted,
  allowsEval: () => allowsEval,
  assert: () => assert,
  assertEqual: () => assertEqual,
  assertIs: () => assertIs,
  assertNever: () => assertNever,
  assertNotEqual: () => assertNotEqual,
  assignProp: () => assignProp,
  base64ToUint8Array: () => base64ToUint8Array,
  base64urlToUint8Array: () => base64urlToUint8Array,
  cached: () => cached,
  captureStackTrace: () => captureStackTrace,
  cleanEnum: () => cleanEnum,
  cleanRegex: () => cleanRegex,
  clone: () => clone,
  cloneDef: () => cloneDef,
  createTransparentProxy: () => createTransparentProxy,
  defineLazy: () => defineLazy,
  esc: () => esc,
  escapeRegex: () => escapeRegex,
  explicitlyAborted: () => explicitlyAborted,
  extend: () => extend,
  finalizeIssue: () => finalizeIssue,
  floatSafeRemainder: () => floatSafeRemainder,
  getElementAtPath: () => getElementAtPath,
  getEnumValues: () => getEnumValues,
  getLengthableOrigin: () => getLengthableOrigin,
  getParsedType: () => getParsedType,
  getSizableOrigin: () => getSizableOrigin,
  hexToUint8Array: () => hexToUint8Array,
  isObject: () => isObject,
  isPlainObject: () => isPlainObject,
  issue: () => issue,
  joinValues: () => joinValues,
  jsonStringifyReplacer: () => jsonStringifyReplacer,
  merge: () => merge,
  mergeDefs: () => mergeDefs,
  normalizeParams: () => normalizeParams,
  nullish: () => nullish,
  numKeys: () => numKeys,
  objectClone: () => objectClone,
  omit: () => omit,
  optionalKeys: () => optionalKeys,
  parsedType: () => parsedType,
  partial: () => partial,
  pick: () => pick,
  prefixIssues: () => prefixIssues,
  primitiveTypes: () => primitiveTypes,
  promiseAllObject: () => promiseAllObject,
  propertyKeyTypes: () => propertyKeyTypes,
  randomString: () => randomString,
  required: () => required,
  safeExtend: () => safeExtend,
  shallowClone: () => shallowClone,
  slugify: () => slugify,
  stringifyPrimitive: () => stringifyPrimitive,
  uint8ArrayToBase64: () => uint8ArrayToBase64,
  uint8ArrayToBase64url: () => uint8ArrayToBase64url,
  uint8ArrayToHex: () => uint8ArrayToHex,
  unwrapMessage: () => unwrapMessage
});
function assertEqual(val) {
  return val;
}
function assertNotEqual(val) {
  return val;
}
function assertIs(_arg) {}
function assertNever(_x) {
  throw new Error("Unexpected value in exhaustive check");
}
function assert(_) {}
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array, separator = "|") {
  return array.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
function cached(getter) {
  const set = false;
  return {
    get value() {
      if (!set) {
        const value = getter();
        Object.defineProperty(this, "value", { value });
        return value;
      }
      throw new Error("cached value already set");
    }
  };
}
function nullish(input) {
  return input === null || input === undefined;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const ratio = val / step;
  const roundedRatio = Math.round(ratio);
  const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
var EVALUATING = /* @__PURE__ */ Symbol("evaluating");
function defineLazy(object, key, getter) {
  let value = undefined;
  Object.defineProperty(object, key, {
    get() {
      if (value === EVALUATING) {
        return;
      }
      if (value === undefined) {
        value = EVALUATING;
        value = getter();
      }
      return value;
    },
    set(v) {
      Object.defineProperty(object, key, {
        value: v
      });
    },
    configurable: true
  });
}
function objectClone(obj) {
  return Object.create(Object.getPrototypeOf(obj), Object.getOwnPropertyDescriptors(obj));
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function cloneDef(schema) {
  return mergeDefs(schema._zod.def);
}
function getElementAtPath(obj, path) {
  if (!path)
    return obj;
  return path.reduce((acc, key) => acc?.[key], obj);
}
function promiseAllObject(promisesObj) {
  const keys = Object.keys(promisesObj);
  const promises = keys.map((key) => promisesObj[key]);
  return Promise.all(promises).then((results) => {
    const resolvedObj = {};
    for (let i = 0;i < keys.length; i++) {
      resolvedObj[keys[i]] = results[i];
    }
    return resolvedObj;
  });
}
function randomString(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let str = "";
  for (let i = 0;i < length; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return str;
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === undefined)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
function numKeys(data) {
  let keyCount = 0;
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      keyCount++;
    }
  }
  return keyCount;
}
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return "undefined";
    case "string":
      return "string";
    case "number":
      return Number.isNaN(data) ? "nan" : "number";
    case "boolean":
      return "boolean";
    case "function":
      return "function";
    case "bigint":
      return "bigint";
    case "symbol":
      return "symbol";
    case "object":
      if (Array.isArray(data)) {
        return "array";
      }
      if (data === null) {
        return "null";
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return "promise";
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return "map";
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return "set";
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return "date";
      }
      if (typeof File !== "undefined" && data instanceof File) {
        return "file";
      }
      return "object";
    default:
      throw new Error(`Unknown data type: ${t}`);
  }
};
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
var primitiveTypes = /* @__PURE__ */ new Set([
  "string",
  "number",
  "bigint",
  "boolean",
  "symbol",
  "undefined"
]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== undefined) {
    if (params?.error !== undefined)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function createTransparentProxy(getter) {
  let target;
  return new Proxy({}, {
    get(_, prop, receiver) {
      target ?? (target = getter());
      return Reflect.get(target, prop, receiver);
    },
    set(_, prop, value, receiver) {
      target ?? (target = getter());
      return Reflect.set(target, prop, value, receiver);
    },
    has(_, prop) {
      target ?? (target = getter());
      return Reflect.has(target, prop);
    },
    deleteProperty(_, prop) {
      target ?? (target = getter());
      return Reflect.deleteProperty(target, prop);
    },
    ownKeys(_) {
      target ?? (target = getter());
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_, prop) {
      target ?? (target = getter());
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    defineProperty(_, prop, descriptor) {
      target ?? (target = getter());
      return Reflect.defineProperty(target, prop, descriptor);
    }
  });
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = {
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-340282346638528860000000000000000000000, 340282346638528860000000000000000000000],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = {};
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        newShape[key] = currDef.shape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const newShape = { ...schema._zod.def.shape };
      for (const key in mask) {
        if (!(key in currDef.shape)) {
          throw new Error(`Unrecognized key: "${key}"`);
        }
        if (!mask[key])
          continue;
        delete newShape[key];
      }
      assignProp(this, "shape", newShape);
      return newShape;
    },
    checks: []
  });
  return clone(schema, def);
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = schema._zod.def.shape;
    for (const key in shape) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== undefined) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema, def);
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const _shape = { ...schema._zod.def.shape, ...shape };
      assignProp(this, "shape", _shape);
      return _shape;
    }
  });
  return clone(schema, def);
}
function merge(a, b) {
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const def = mergeDefs(a._zod.def, {
    get shape() {
      const _shape = { ...a._zod.def.shape, ...b._zod.def.shape };
      assignProp(this, "shape", _shape);
      return _shape;
    },
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class, schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".partial() cannot be used on object schemas containing refinements");
  }
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in oldShape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = Class ? new Class({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      } else {
        for (const key in oldShape) {
          shape[key] = Class ? new Class({
            type: "optional",
            innerType: oldShape[key]
          }) : oldShape[key];
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    },
    checks: []
  });
  return clone(schema, def);
}
function required(Class, schema, mask) {
  const def = mergeDefs(schema._zod.def, {
    get shape() {
      const oldShape = schema._zod.def.shape;
      const shape = { ...oldShape };
      if (mask) {
        for (const key in mask) {
          if (!(key in shape)) {
            throw new Error(`Unrecognized key: "${key}"`);
          }
          if (!mask[key])
            continue;
          shape[key] = new Class({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      } else {
        for (const key in oldShape) {
          shape[key] = new Class({
            type: "nonoptional",
            innerType: oldShape[key]
          });
        }
      }
      assignProp(this, "shape", shape);
      return shape;
    }
  });
  return clone(schema, def);
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex;i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path, issues) {
  return issues.map((iss) => {
    var _a2;
    (_a2 = iss).path ?? (_a2.path = []);
    iss.path.unshift(path);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config2) {
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
  const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
  rest.path ?? (rest.path = []);
  rest.message = message;
  if (ctx?.reportInput) {
    rest.input = _input;
  }
  return rest;
}
function getSizableOrigin(input) {
  if (input instanceof Set)
    return "set";
  if (input instanceof Map)
    return "map";
  if (input instanceof File)
    return "file";
  return "unknown";
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t;
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
function cleanEnum(obj) {
  return Object.entries(obj).filter(([k, _]) => {
    return Number.isNaN(Number.parseInt(k, 10));
  }).map((el) => el[1]);
}
function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0;i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
function uint8ArrayToBase64(bytes) {
  let binaryString = "";
  for (let i = 0;i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}
function base64urlToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - base64.length % 4) % 4);
  return base64ToUint8Array(base64 + padding);
}
function uint8ArrayToBase64url(bytes) {
  return uint8ArrayToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function hexToUint8Array(hex) {
  const cleanHex = hex.replace(/^0x/, "");
  if (cleanHex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0;i < cleanHex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return bytes;
}
function uint8ArrayToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

class Class {
  constructor(..._args) {}
}

// ../../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/errors.js
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  Object.defineProperty(inst, "_zod", {
    value: inst._zod,
    enumerable: false
  });
  Object.defineProperty(inst, "issues", {
    value: def,
    enumerable: false
  });
  inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
  Object.defineProperty(inst, "toString", {
    value: () => inst.message,
    enumerable: false
  });
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, { Parent: Error });
function flattenError(error, mapper = (issue2) => issue2.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error.issues) {
    if (sub.path.length > 0) {
      fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
      fieldErrors[sub.path[0]].push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error, mapper = (issue2) => issue2.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error2, path = []) => {
    for (const issue2 of error2.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }, [...path, ...issue2.path]));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues }, [...path, ...issue2.path]);
      } else {
        const fullpath = [...path, ...issue2.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue2));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue2));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    }
  };
  processError(error);
  return fieldErrors;
}

// ../../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/parse.js
var _parse = (_Err) => (schema, value, _ctx, _params) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  if (result.issues.length) {
    const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, _params?.callee);
    throw e;
  }
  return result.value;
};
var _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  if (result.issues.length) {
    const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
    captureStackTrace(e, params?.callee);
    throw e;
  }
  return result.value;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError;
  }
  return result.issues.length ? {
    success: false,
    error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParse = /* @__PURE__ */ _safeParse($ZodRealError);
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? {
    success: false,
    error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  } : { success: true, data: result.value };
};
var safeParseAsync = /* @__PURE__ */ _safeParseAsync($ZodRealError);
var _encode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _parse(_Err)(schema, value, ctx);
};
var _decode = (_Err) => (schema, value, _ctx) => {
  return _parse(_Err)(schema, value, _ctx);
};
var _encodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _parseAsync(_Err)(schema, value, ctx);
};
var _decodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _parseAsync(_Err)(schema, value, _ctx);
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};
// ../../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/regexes.js
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version) => {
  if (!version)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^[A-Za-z0-9_-]*$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
var date = /* @__PURE__ */ new RegExp(`^${dateSource}$`);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const time2 = timeSource({ precision: args.precision });
  const opts = ["Z"];
  if (args.local)
    opts.push("");
  if (args.offset)
    opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const timeRegex = `${time2}(?:${opts.join("|")})`;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var string = (params) => {
  const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
  return new RegExp(`^${regex}$`);
};
var integer = /^-?\d+$/;
var number = /^-?\d+(?:\.\d+)?$/;
var boolean = /^(?:true|false)$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;

// ../../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a2;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a2 = inst._zod).onattach ?? (_a2.onattach = []);
});
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
    if (def.value < curr) {
      if (def.inclusive)
        bag.maximum = def.value;
      else
        bag.exclusiveMaximum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
    if (def.value > curr) {
      if (def.inclusive)
        bag.minimum = def.value;
      else
        bag.exclusiveMinimum = def.value;
    }
  });
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    var _a2;
    (_a2 = inst2._zod.bag).multipleOf ?? (_a2.multipleOf = def.value);
  });
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    bag.minimum = minimum;
    bag.maximum = maximum;
    if (isInt)
      bag.pattern = integer;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a2;
  $ZodCheck.init(inst, def);
  (_a2 = inst._zod.def).when ?? (_a2.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
    if (def.maximum < curr)
      inst2._zod.bag.maximum = def.maximum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a2;
  $ZodCheck.init(inst, def);
  (_a2 = inst._zod.def).when ?? (_a2.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst2) => {
    const curr = inst2._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
    if (def.minimum > curr)
      inst2._zod.bag.minimum = def.minimum;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a2;
  $ZodCheck.init(inst, def);
  (_a2 = inst._zod.def).when ?? (_a2.when = (payload) => {
    const val = payload.value;
    return !nullish(val) && val.length !== undefined;
  });
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.minimum = def.length;
    bag.maximum = def.length;
    bag.length = def.length;
  });
  inst._zod.check = (payload) => {
    const input = payload.value;
    const length = input.length;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a2, _b;
  $ZodCheck.init(inst, def);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.format = def.format;
    if (def.pattern) {
      bag.patterns ?? (bag.patterns = new Set);
      bag.patterns.add(def.pattern);
    }
  });
  if (def.pattern)
    (_a2 = inst._zod).check ?? (_a2.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {});
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.onattach.push((inst2) => {
    const bag = inst2._zod.bag;
    bag.patterns ?? (bag.patterns = new Set);
    bag.patterns.add(pattern);
  });
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// ../../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/doc.js
class Doc {
  constructor(args = []) {
    this.content = [];
    this.indent = 0;
    if (this)
      this.args = args;
  }
  indented(fn) {
    this.indent += 1;
    fn(this);
    this.indent -= 1;
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split(`
`).filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const args = this?.args;
    const content = this?.content ?? [``];
    const lines = [...content.map((x) => `  ${x}`)];
    return new F(...args, lines.join(`
`));
  }
}

// ../../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 4,
  patch: 3
};

// ../../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a2;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const checks = [...inst._zod.def.checks ?? []];
  if (inst._zod.traits.has("$ZodCheck")) {
    checks.unshift(inst);
  }
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a2 = inst._zod).deferred ?? (_a2.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError;
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return checkResult.then((checkResult2) => inst._zod.parse(checkResult2, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary2) => {
            return handleCanaryResult(canary2, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError;
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
  defineLazy(inst, "~standard", () => ({
    validate: (value) => {
      try {
        const r = safeParse(inst, value);
        return r.success ? { value: r.data } : { issues: r.error?.issues };
      } catch (_) {
        return safeParseAsync(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
      }
    },
    vendor: "zod",
    version: 1
  }));
});
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string(inst._zod.bag);
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_2) {}
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === undefined)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      if (!def.normalize && def.protocol?.source === httpProtocol.source) {
        if (!/^https?:\/\//i.test(trimmed)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid URL format",
            input: payload.value,
            inst,
            continue: !def.abort
          });
          return;
        }
      }
      const url = new URL(trimmed);
      if (def.hostname) {
        def.hostname.lastIndex = 0;
        if (!def.hostname.test(url.hostname)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid hostname",
            pattern: def.hostname.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.protocol) {
        def.protocol.lastIndex = 0;
        if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) {
          payload.issues.push({
            code: "invalid_format",
            format: "url",
            note: "Invalid protocol",
            pattern: def.protocol.source,
            input: payload.value,
            inst,
            continue: !def.abort
          });
        }
      }
      if (def.normalize) {
        payload.value = url.href;
      } else {
        payload.value = trimmed;
      }
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  def.pattern ?? (def.pattern = nanoid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv4`;
});
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.format = `ipv6`;
  inst._zod.check = (payload) => {
    try {
      new URL(`http://[${payload.value}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    const parts = payload.value.split("/");
    try {
      if (parts.length !== 2)
        throw new Error;
      const [address, prefix] = parts;
      if (!prefix)
        throw new Error;
      const prefixNum = Number(prefix);
      if (`${prefixNum}` !== prefix)
        throw new Error;
      if (prefixNum < 0 || prefixNum > 128)
        throw new Error;
      new URL(`http://[${address}]`);
    } catch {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64";
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
function isValidBase64URL(data) {
  if (!base64url.test(data))
    return false;
  const base642 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base642.padEnd(Math.ceil(base642.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64url);
  $ZodStringFormat.init(inst, def);
  inst._zod.bag.contentEncoding = "base64url";
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = inst._zod.bag.pattern ?? number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : undefined : undefined;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {}
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = Array(input.length);
    const proms = [];
    for (let i = 0;i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
  const isPresent = key in input;
  if (result.issues.length) {
    if (isOptionalIn && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && !isOptionalIn) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: undefined,
        path: [key]
      });
    }
    return;
  }
  if (result.value === undefined) {
    if (isPresent) {
      final.value[key] = undefined;
    }
  } else {
    final.value[key] = result.value;
  }
}
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  for (const k of keys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    keys,
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const isOptionalIn = _catchall.optin === "optional";
  const isOptionalOut = _catchall.optout === "optional";
  for (const key in input) {
    if (key === "__proto__")
      continue;
    if (keySet.has(key))
      continue;
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, isOptionalIn, isOptionalOut)));
    } else {
      handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  if (!desc?.get) {
    const sh = def.shape;
    Object.defineProperty(def, "shape", {
      get: () => {
        const newSh = { ...sh };
        Object.defineProperty(def, "shape", {
          value: newSh
        });
        return newSh;
      }
    });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazy(inst._zod, "propValues", () => {
    const shape = def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        propValues[key] ?? (propValues[key] = new Set);
        for (const v of field.values)
          propValues[key].add(v);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = {};
    const proms = [];
    const shape = value.shape;
    for (const key of value.keys) {
      const el = shape[key];
      const isOptionalIn = el._zod.optin === "optional";
      const isOptionalOut = el._zod.optout === "optional";
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, isOptionalIn, isOptionalOut)));
      } else {
        handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
  };
});
var $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const generateFastpass = (shape) => {
    const doc = new Doc(["shape", "payload", "ctx"]);
    const normalized = _normalized.value;
    const parseStr = (key) => {
      const k = esc(key);
      return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    };
    doc.write(`const input = payload.value;`);
    const ids = Object.create(null);
    let counter = 0;
    for (const key of normalized.keys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(`const newResult = {};`);
    for (const key of normalized.keys) {
      const id = ids[key];
      const k = esc(key);
      const schema = shape[key];
      const isOptionalIn = schema?._zod?.optin === "optional";
      const isOptionalOut = schema?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(key)};`);
      if (isOptionalIn && isOptionalOut) {
        doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
      } else if (!isOptionalIn) {
        doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
      } else {
        doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    const fn = doc.compile();
    return (payload, ctx) => fn(shape, payload, ctx);
  };
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : undefined);
  defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : undefined);
  defineLazy(inst._zod, "values", () => {
    if (def.options.every((o) => o._zod.values)) {
      return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return;
  });
  defineLazy(inst._zod, "pattern", () => {
    if (def.options.every((o) => o._zod.pattern)) {
      const patterns = def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results2) => {
      return handleUnionResults(results2, payload, inst, ctx);
    });
  };
});
var $ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("$ZodDiscriminatedUnion", (inst, def) => {
  def.inclusive = false;
  $ZodUnion.init(inst, def);
  const _super = inst._zod.parse;
  defineLazy(inst._zod, "propValues", () => {
    const propValues = {};
    for (const option of def.options) {
      const pv = option._zod.propValues;
      if (!pv || Object.keys(pv).length === 0)
        throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(option)}"`);
      for (const [k, v] of Object.entries(pv)) {
        if (!propValues[k])
          propValues[k] = new Set;
        for (const val of v) {
          propValues[k].add(val);
        }
      }
    }
    return propValues;
  });
  const disc = cached(() => {
    const opts = def.options;
    const map = new Map;
    for (const o of opts) {
      const values = o._zod.propValues?.[def.discriminator];
      if (!values || values.size === 0)
        throw new Error(`Invalid discriminated union option at index "${def.options.indexOf(o)}"`);
      for (const v of values) {
        if (map.has(v)) {
          throw new Error(`Duplicate discriminator value "${String(v)}"`);
        }
        map.set(v, o);
      }
    }
    return map;
  });
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isObject(input)) {
      payload.issues.push({
        code: "invalid_type",
        expected: "object",
        input,
        inst
      });
      return payload;
    }
    const opt = disc.value.get(input?.[def.discriminator]);
    if (opt) {
      return opt._zod.run(payload, ctx);
    }
    if (def.unionFallback || ctx.direction === "backward") {
      return _super(payload, ctx);
    }
    payload.issues.push({
      code: "invalid_union",
      errors: [],
      note: "No matching discriminator",
      discriminator: def.discriminator,
      options: Array.from(disc.value.keys()),
      input,
      path: [def.discriminator],
      inst
    });
    return payload;
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left2, right2]) => {
        return handleIntersectionResults(payload, left2, right2);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0;index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = new Map;
  let unrecIssue;
  for (const iss of left.issues) {
    if (iss.code === "unrecognized_keys") {
      unrecIssue ?? (unrecIssue = iss);
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).l = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  for (const iss of right.issues) {
    if (iss.code === "unrecognized_keys") {
      for (const k of iss.keys) {
        if (!unrecKeys.has(k))
          unrecKeys.set(k, {});
        unrecKeys.get(k).r = true;
      }
    } else {
      result.issues.push(iss);
    }
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length && unrecIssue) {
    result.issues.push({ ...unrecIssue, keys: bothKeys });
  }
  if (aborted(result))
    return result;
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    throw new Error(`Unmergable intersection. Error path: ` + `${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isPlainObject(input)) {
      payload.issues.push({
        expected: "record",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    const values = def.keyType._zod.values;
    if (values) {
      payload.value = {};
      const recordKeys = new Set;
      for (const key of values) {
        if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
          recordKeys.add(typeof key === "number" ? key.toString() : key);
          const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
          if (keyResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (keyResult.issues.length) {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
            continue;
          }
          const outKey = keyResult.value;
          const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result2) => {
              if (result2.issues.length) {
                payload.issues.push(...prefixIssues(key, result2.issues));
              }
              payload.value[outKey] = result2.value;
            }));
          } else {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[outKey] = result.value;
          }
        }
      }
      let unrecognized;
      for (const key in input) {
        if (!recordKeys.has(key)) {
          unrecognized = unrecognized ?? [];
          unrecognized.push(key);
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized
        });
      }
    } else {
      payload.value = {};
      for (const key of Reflect.ownKeys(input)) {
        if (key === "__proto__")
          continue;
        if (!Object.prototype.propertyIsEnumerable.call(input, key))
          continue;
        let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
        if (keyResult instanceof Promise) {
          throw new Error("Async schemas not supported in object keys currently");
        }
        const checkNumericKey = typeof key === "string" && number.test(key) && keyResult.issues.length;
        if (checkNumericKey) {
          const retryResult = def.keyType._zod.run({ value: Number(key), issues: [] }, ctx);
          if (retryResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (retryResult.issues.length === 0) {
            keyResult = retryResult;
          }
        }
        if (keyResult.issues.length) {
          if (def.mode === "loose") {
            payload.value[key] = input[key];
          } else {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
          }
          continue;
        }
        const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((result2) => {
            if (result2.issues.length) {
              payload.issues.push(...prefixIssues(key, result2.issues));
            }
            payload.value[keyResult.value] = result2.value;
          }));
        } else {
          if (result.issues.length) {
            payload.issues.push(...prefixIssues(key, result.issues));
          }
          payload.value[keyResult.value] = result.value;
        }
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  if (def.values.length === 0) {
    throw new Error("Cannot create literal schema with no valid values");
  }
  const values = new Set(def.values);
  inst._zod.values = values;
  inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output2) => {
        payload.value = output2;
        payload.fallback = true;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError;
    }
    payload.value = _out;
    payload.fallback = true;
    return payload;
  };
});
function handleOptionalResult(result, input) {
  if (input === undefined && (result.issues.length || result.fallback)) {
    return { issues: [], value: undefined };
  }
  return result;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  inst._zod.optout = "optional";
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? new Set([...def.innerType._zod.values, undefined]) : undefined;
  });
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (def.innerType._zod.optin === "optional") {
      const input = payload.value;
      const result = def.innerType._zod.run(payload, ctx);
      if (result instanceof Promise)
        return result.then((r) => handleOptionalResult(r, input));
      return handleOptionalResult(result, input);
    }
    if (payload.value === undefined) {
      return payload;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "pattern", () => {
    const pattern = def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : undefined;
  });
  defineLazy(inst._zod, "values", () => {
    return def.innerType._zod.values ? new Set([...def.innerType._zod.values, null]) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleDefaultResult(result2, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === undefined) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === undefined) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => {
    const v = def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== undefined)) : undefined;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleNonOptionalResult(result2, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === undefined) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => {
        payload.value = result2.value;
        if (result2.issues.length) {
          payload.value = def.catchValue({
            ...payload,
            error: {
              issues: result2.issues.map((iss) => finalizeIssue(iss, ctx, config()))
            },
            input: payload.value
          });
          payload.issues = [];
          payload.fallback = true;
        }
        return payload;
      });
    }
    payload.value = result.value;
    if (result.issues.length) {
      payload.value = def.catchValue({
        ...payload,
        error: {
          issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
        },
        input: payload.value
      });
      payload.issues = [];
      payload.fallback = true;
    }
    return payload;
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "values", () => def.in._zod.values);
  defineLazy(inst._zod, "optin", () => def.in._zod.optin);
  defineLazy(inst._zod, "optout", () => def.out._zod.optout);
  defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right2) => handlePipeResult(right2, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left2) => handlePipeResult(left2, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.length) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues, fallback: left.fallback }, ctx);
}
var $ZodPreprocess = /* @__PURE__ */ $constructor("$ZodPreprocess", (inst, def) => {
  $ZodPipe.init(inst, def);
});
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
  defineLazy(inst._zod, "values", () => def.innerType._zod.values);
  defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
  defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r2) => handleRefineResult(r2, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      path: [...inst._zod.def.path ?? []],
      continue: !inst._zod.def.abort
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}
// ../../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/registries.js
var _a2;
var $output = Symbol("ZodOutput");
var $input = Symbol("ZodInput");

class $ZodRegistry {
  constructor() {
    this._map = new WeakMap;
    this._idmap = new Map;
  }
  add(schema, ..._meta) {
    const meta = _meta[0];
    this._map.set(schema, meta);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.set(meta.id, schema);
    }
    return this;
  }
  clear() {
    this._map = new WeakMap;
    this._idmap = new Map;
    return this;
  }
  remove(schema) {
    const meta = this._map.get(schema);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.delete(meta.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      const f = { ...pm, ...this._map.get(schema) };
      return Object.keys(f).length ? f : undefined;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
}
function registry() {
  return new $ZodRegistry;
}
(_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;
// ../../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/api.js
function _string(Class2, params) {
  return new Class2({
    type: "string",
    ...normalizeParams(params)
  });
}
function _email(Class2, params) {
  return new Class2({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _guid(Class2, params) {
  return new Class2({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _uuidv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
function _uuidv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
function _uuidv7(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
function _url(Class2, params) {
  return new Class2({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _emoji2(Class2, params) {
  return new Class2({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _nanoid(Class2, params) {
  return new Class2({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cuid2(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ulid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _xid(Class2, params) {
  return new Class2({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ksuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _ipv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _cidrv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _base64url(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _e164(Class2, params) {
  return new Class2({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _jwt(Class2, params) {
  return new Class2({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
function _isoDateTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDate(Class2, params) {
  return new Class2({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _isoTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
function _isoDuration(Class2, params) {
  return new Class2({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
function _number(Class2, params) {
  return new Class2({
    type: "number",
    checks: [],
    ...normalizeParams(params)
  });
}
function _int(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
function _boolean(Class2, params) {
  return new Class2({
    type: "boolean",
    ...normalizeParams(params)
  });
}
function _unknown(Class2) {
  return new Class2({
    type: "unknown"
  });
}
function _never(Class2, params) {
  return new Class2({
    type: "never",
    ...normalizeParams(params)
  });
}
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
function _normalize(form) {
  return _overwrite((input) => input.normalize(form));
}
function _trim() {
  return _overwrite((input) => input.trim());
}
function _toLowerCase() {
  return _overwrite((input) => input.toLowerCase());
}
function _toUpperCase() {
  return _overwrite((input) => input.toUpperCase());
}
function _slugify() {
  return _overwrite((input) => slugify(input));
}
function _array(Class2, element, params) {
  return new Class2({
    type: "array",
    element,
    ...normalizeParams(params)
  });
}
function _refine(Class2, fn, _params) {
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
function _superRefine(fn, params) {
  const ch = _check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  }, params);
  return ch;
}
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}
// ../../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/to-json-schema.js
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {}),
    io: params?.io ?? "output",
    counter: 0,
    seen: new Map,
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    external: params?.external ?? undefined
  };
}
function process2(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a3;
  const def = schema._zod.def;
  const seen = ctx.seen.get(schema);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: undefined, path: _params.path };
  ctx.seen.set(schema, result);
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema) {
      schema._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      process2(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta = ctx.metadataRegistry.get(schema);
  if (meta)
    Object.assign(result.schema, meta);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a3 = result.schema).default ?? (_a3.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const idToSchema = new Map;
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id2) => id2);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}` };
    }
    if (entry[1] === root) {
      return { ref: "#" };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + defId };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema2 = seen.schema;
    for (const key in schema2) {
      delete schema2[key];
    }
    schema2.$ref = ref;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error("Cycle detected: " + `#/${seen.cycle?.join("/")}/<root>` + '\n\nSet the `cycles` parameter to `"ref"` to resolve cyclical schemas with defs.');
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
        continue;
      }
    }
  }
}
function finalize(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema2 = seen.def ?? seen.schema;
    const _cached = { ...schema2 };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema2.allOf = schema2.allOf ?? [];
        schema2.allOf.push(refSchema);
      } else {
        Object.assign(schema2, refSchema);
      }
      Object.assign(schema2, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema2[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema2[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema2.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema2) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema2[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema2,
      path: seen.path ?? []
    });
  };
  for (const entry of [...ctx.seen.entries()].reverse()) {
    flattenRef(entry[0]);
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") {}
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema)?.id;
    if (!id)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  Object.assign(result, root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== undefined && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (seen.def && seen.defId) {
      if (seen.def.id === seen.defId)
        delete seen.def.id;
      defs[seen.defId] = seen.def;
    }
  }
  if (ctx.external) {} else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: new Set };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  process2(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  process2(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
// ../../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/core/json-schema-processors.js
var formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
};
var stringProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  json.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
  if (typeof minimum === "number")
    json.minLength = minimum;
  if (typeof maximum === "number")
    json.maxLength = maximum;
  if (format) {
    json.format = formatMap[format] ?? format;
    if (json.format === "")
      delete json.format;
    if (format === "time") {
      delete json.format;
    }
  }
  if (contentEncoding)
    json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const regexes = [...patterns];
    if (regexes.length === 1)
      json.pattern = regexes[0].source;
    else if (regexes.length > 1) {
      json.allOf = [
        ...regexes.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
    }
  }
};
var numberProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
  if (typeof format === "string" && format.includes("int"))
    json.type = "integer";
  else
    json.type = "number";
  const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
  const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
  const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin) {
    if (legacy) {
      json.minimum = exclusiveMinimum;
      json.exclusiveMinimum = true;
    } else {
      json.exclusiveMinimum = exclusiveMinimum;
    }
  } else if (typeof minimum === "number") {
    json.minimum = minimum;
  }
  if (exMax) {
    if (legacy) {
      json.maximum = exclusiveMaximum;
      json.exclusiveMaximum = true;
    } else {
      json.exclusiveMaximum = exclusiveMaximum;
    }
  } else if (typeof maximum === "number") {
    json.maximum = maximum;
  }
  if (typeof multipleOf === "number")
    json.multipleOf = multipleOf;
};
var booleanProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
};
var neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
};
var unknownProcessor = (_schema, _ctx, _json, _params) => {};
var enumProcessor = (schema, _ctx, json, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.every((v) => typeof v === "number"))
    json.type = "number";
  if (values.every((v) => typeof v === "string"))
    json.type = "string";
  json.enum = values;
};
var literalProcessor = (schema, ctx, json, _params) => {
  const def = schema._zod.def;
  const vals = [];
  for (const val of def.values) {
    if (val === undefined) {
      if (ctx.unrepresentable === "throw") {
        throw new Error("Literal `undefined` cannot be represented in JSON Schema");
      }
    } else if (typeof val === "bigint") {
      if (ctx.unrepresentable === "throw") {
        throw new Error("BigInt literals cannot be represented in JSON Schema");
      } else {
        vals.push(Number(val));
      }
    } else {
      vals.push(val);
    }
  }
  if (vals.length === 0) {} else if (vals.length === 1) {
    const val = vals[0];
    json.type = val === null ? "null" : typeof val;
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json.enum = [val];
    } else {
      json.const = val;
    }
  } else {
    if (vals.every((v) => typeof v === "number"))
      json.type = "number";
    if (vals.every((v) => typeof v === "string"))
      json.type = "string";
    if (vals.every((v) => typeof v === "boolean"))
      json.type = "boolean";
    if (vals.every((v) => v === null))
      json.type = "null";
    json.enum = vals;
  }
};
var customProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Custom types cannot be represented in JSON Schema");
  }
};
var transformProcessor = (_schema, ctx, _json, _params) => {
  if (ctx.unrepresentable === "throw") {
    throw new Error("Transforms cannot be represented in JSON Schema");
  }
};
var arrayProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = schema._zod.bag;
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
  json.type = "array";
  json.items = process2(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
var objectProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "object";
  json.properties = {};
  const shape = def.shape;
  for (const key in shape) {
    json.properties[key] = process2(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    });
  }
  const allKeys = new Set(Object.keys(shape));
  const requiredKeys = new Set([...allKeys].filter((key) => {
    const v = def.shape[key]._zod;
    if (ctx.io === "input") {
      return v.optin === undefined;
    } else {
      return v.optout === undefined;
    }
  }));
  if (requiredKeys.size > 0) {
    json.required = Array.from(requiredKeys);
  }
  if (def.catchall?._zod.def.type === "never") {
    json.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json.additionalProperties = false;
  } else if (def.catchall) {
    json.additionalProperties = process2(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
var unionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => process2(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json.oneOf = options;
  } else {
    json.anyOf = options;
  }
};
var intersectionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const a = process2(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = process2(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => ("allOf" in val) && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json.allOf = allOf;
};
var recordProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "object";
  const keyType = def.keyType;
  const keyBag = keyType._zod.bag;
  const patterns = keyBag?.patterns;
  if (def.mode === "loose" && patterns && patterns.size > 0) {
    const valueSchema = process2(def.valueType, ctx, {
      ...params,
      path: [...params.path, "patternProperties", "*"]
    });
    json.patternProperties = {};
    for (const pattern of patterns) {
      json.patternProperties[pattern.source] = valueSchema;
    }
  } else {
    if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
      json.propertyNames = process2(def.keyType, ctx, {
        ...params,
        path: [...params.path, "propertyNames"]
      });
    }
    json.additionalProperties = process2(def.valueType, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
  const keyValues = keyType._zod.values;
  if (keyValues) {
    const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
    if (validKeyValues.length > 0) {
      json.required = validKeyValues;
    }
  }
};
var nullableProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const inner = process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json.nullable = true;
  } else {
    json.anyOf = [inner, { type: "null" }];
  }
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var defaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.default = JSON.parse(JSON.stringify(def.defaultValue));
};
var prefaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io === "input")
    json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};
var catchProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(undefined);
  } catch {
    throw new Error("Dynamic catch values are not supported in JSON Schema");
  }
  json.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  process2(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.readOnly = true;
};
var optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  process2(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
// ../../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/classic/iso.js
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function datetime2(params) {
  return _isoDateTime(ZodISODateTime, params);
}
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function date2(params) {
  return _isoDate(ZodISODate, params);
}
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function time2(params) {
  return _isoTime(ZodISOTime, params);
}
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function duration2(params) {
  return _isoDuration(ZodISODuration, params);
}

// ../../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/classic/errors.js
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  Object.defineProperties(inst, {
    format: {
      value: (mapper) => formatError(inst, mapper)
    },
    flatten: {
      value: (mapper) => flattenError(inst, mapper)
    },
    addIssue: {
      value: (issue2) => {
        inst.issues.push(issue2);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
    },
    addIssues: {
      value: (issues2) => {
        inst.issues.push(...issues2);
        inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
      }
    },
    isEmpty: {
      get() {
        return inst.issues.length === 0;
      }
    }
  });
};
var ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer2, {
  Parent: Error
});

// ../../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/classic/parse.js
var parse3 = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync2 = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse2 = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync2 = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

// ../../../node_modules/.bun/zod@4.4.3/node_modules/zod/v4/classic/schemas.js
var _installedGroups = /* @__PURE__ */ new WeakMap;
function _installLazyMethods(inst, group, methods) {
  const proto = Object.getPrototypeOf(inst);
  let installed = _installedGroups.get(proto);
  if (!installed) {
    installed = new Set;
    _installedGroups.set(proto, installed);
  }
  if (installed.has(group))
    return;
  installed.add(group);
  for (const key in methods) {
    const fn = methods[key];
    Object.defineProperty(proto, key, {
      configurable: true,
      enumerable: false,
      get() {
        const bound = fn.bind(this);
        Object.defineProperty(this, key, {
          configurable: true,
          writable: true,
          enumerable: true,
          value: bound
        });
        return bound;
      },
      set(v) {
        Object.defineProperty(this, key, {
          configurable: true,
          writable: true,
          enumerable: true,
          value: v
        });
      }
    });
  }
}
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  $ZodType.init(inst, def);
  Object.assign(inst["~standard"], {
    jsonSchema: {
      input: createStandardJSONSchemaMethod(inst, "input"),
      output: createStandardJSONSchemaMethod(inst, "output")
    }
  });
  inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
  inst.def = def;
  inst.type = def.type;
  Object.defineProperty(inst, "_def", { value: def });
  inst.parse = (data, params) => parse3(inst, data, params, { callee: inst.parse });
  inst.safeParse = (data, params) => safeParse2(inst, data, params);
  inst.parseAsync = async (data, params) => parseAsync2(inst, data, params, { callee: inst.parseAsync });
  inst.safeParseAsync = async (data, params) => safeParseAsync2(inst, data, params);
  inst.spa = inst.safeParseAsync;
  inst.encode = (data, params) => encode(inst, data, params);
  inst.decode = (data, params) => decode(inst, data, params);
  inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
  inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
  inst.safeEncode = (data, params) => safeEncode(inst, data, params);
  inst.safeDecode = (data, params) => safeDecode(inst, data, params);
  inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
  inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
  _installLazyMethods(inst, "ZodType", {
    check(...chks) {
      const def2 = this.def;
      return this.clone(exports_util.mergeDefs(def2, {
        checks: [
          ...def2.checks ?? [],
          ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
        ]
      }), { parent: true });
    },
    with(...chks) {
      return this.check(...chks);
    },
    clone(def2, params) {
      return clone(this, def2, params);
    },
    brand() {
      return this;
    },
    register(reg, meta2) {
      reg.add(this, meta2);
      return this;
    },
    refine(check, params) {
      return this.check(refine(check, params));
    },
    superRefine(refinement, params) {
      return this.check(superRefine(refinement, params));
    },
    overwrite(fn) {
      return this.check(_overwrite(fn));
    },
    optional() {
      return optional(this);
    },
    exactOptional() {
      return exactOptional(this);
    },
    nullable() {
      return nullable(this);
    },
    nullish() {
      return optional(nullable(this));
    },
    nonoptional(params) {
      return nonoptional(this, params);
    },
    array() {
      return array(this);
    },
    or(arg) {
      return union([this, arg]);
    },
    and(arg) {
      return intersection(this, arg);
    },
    transform(tx) {
      return pipe(this, transform(tx));
    },
    default(d) {
      return _default(this, d);
    },
    prefault(d) {
      return prefault(this, d);
    },
    catch(params) {
      return _catch(this, params);
    },
    pipe(target) {
      return pipe(this, target);
    },
    readonly() {
      return readonly(this);
    },
    describe(description) {
      const cl = this.clone();
      globalRegistry.add(cl, { description });
      return cl;
    },
    meta(...args) {
      if (args.length === 0)
        return globalRegistry.get(this);
      const cl = this.clone();
      globalRegistry.add(cl, args[0]);
      return cl;
    },
    isOptional() {
      return this.safeParse(undefined).success;
    },
    isNullable() {
      return this.safeParse(null).success;
    },
    apply(fn) {
      return fn(this);
    }
  });
  Object.defineProperty(inst, "description", {
    get() {
      return globalRegistry.get(inst)?.description;
    },
    configurable: true
  });
  return inst;
});
var _ZodString = /* @__PURE__ */ $constructor("_ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
  const bag = inst._zod.bag;
  inst.format = bag.format ?? null;
  inst.minLength = bag.minimum ?? null;
  inst.maxLength = bag.maximum ?? null;
  _installLazyMethods(inst, "_ZodString", {
    regex(...args) {
      return this.check(_regex(...args));
    },
    includes(...args) {
      return this.check(_includes(...args));
    },
    startsWith(...args) {
      return this.check(_startsWith(...args));
    },
    endsWith(...args) {
      return this.check(_endsWith(...args));
    },
    min(...args) {
      return this.check(_minLength(...args));
    },
    max(...args) {
      return this.check(_maxLength(...args));
    },
    length(...args) {
      return this.check(_length(...args));
    },
    nonempty(...args) {
      return this.check(_minLength(1, ...args));
    },
    lowercase(params) {
      return this.check(_lowercase(params));
    },
    uppercase(params) {
      return this.check(_uppercase(params));
    },
    trim() {
      return this.check(_trim());
    },
    normalize(...args) {
      return this.check(_normalize(...args));
    },
    toLowerCase() {
      return this.check(_toLowerCase());
    },
    toUpperCase() {
      return this.check(_toUpperCase());
    },
    slugify() {
      return this.check(_slugify());
    }
  });
});
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
  inst.email = (params) => inst.check(_email(ZodEmail, params));
  inst.url = (params) => inst.check(_url(ZodURL, params));
  inst.jwt = (params) => inst.check(_jwt(ZodJWT, params));
  inst.emoji = (params) => inst.check(_emoji2(ZodEmoji, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.uuid = (params) => inst.check(_uuid(ZodUUID, params));
  inst.uuidv4 = (params) => inst.check(_uuidv4(ZodUUID, params));
  inst.uuidv6 = (params) => inst.check(_uuidv6(ZodUUID, params));
  inst.uuidv7 = (params) => inst.check(_uuidv7(ZodUUID, params));
  inst.nanoid = (params) => inst.check(_nanoid(ZodNanoID, params));
  inst.guid = (params) => inst.check(_guid(ZodGUID, params));
  inst.cuid = (params) => inst.check(_cuid(ZodCUID, params));
  inst.cuid2 = (params) => inst.check(_cuid2(ZodCUID2, params));
  inst.ulid = (params) => inst.check(_ulid(ZodULID, params));
  inst.base64 = (params) => inst.check(_base64(ZodBase64, params));
  inst.base64url = (params) => inst.check(_base64url(ZodBase64URL, params));
  inst.xid = (params) => inst.check(_xid(ZodXID, params));
  inst.ksuid = (params) => inst.check(_ksuid(ZodKSUID, params));
  inst.ipv4 = (params) => inst.check(_ipv4(ZodIPv4, params));
  inst.ipv6 = (params) => inst.check(_ipv6(ZodIPv6, params));
  inst.cidrv4 = (params) => inst.check(_cidrv4(ZodCIDRv4, params));
  inst.cidrv6 = (params) => inst.check(_cidrv6(ZodCIDRv6, params));
  inst.e164 = (params) => inst.check(_e164(ZodE164, params));
  inst.datetime = (params) => inst.check(datetime2(params));
  inst.date = (params) => inst.check(date2(params));
  inst.time = (params) => inst.check(time2(params));
  inst.duration = (params) => inst.check(duration2(params));
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNumber = /* @__PURE__ */ $constructor("ZodNumber", (inst, def) => {
  $ZodNumber.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
  _installLazyMethods(inst, "ZodNumber", {
    gt(value, params) {
      return this.check(_gt(value, params));
    },
    gte(value, params) {
      return this.check(_gte(value, params));
    },
    min(value, params) {
      return this.check(_gte(value, params));
    },
    lt(value, params) {
      return this.check(_lt(value, params));
    },
    lte(value, params) {
      return this.check(_lte(value, params));
    },
    max(value, params) {
      return this.check(_lte(value, params));
    },
    int(params) {
      return this.check(int(params));
    },
    safe(params) {
      return this.check(int(params));
    },
    positive(params) {
      return this.check(_gt(0, params));
    },
    nonnegative(params) {
      return this.check(_gte(0, params));
    },
    negative(params) {
      return this.check(_lt(0, params));
    },
    nonpositive(params) {
      return this.check(_lte(0, params));
    },
    multipleOf(value, params) {
      return this.check(_multipleOf(value, params));
    },
    step(value, params) {
      return this.check(_multipleOf(value, params));
    },
    finite() {
      return this;
    }
  });
  const bag = inst._zod.bag;
  inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
  inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
  inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? 0.5);
  inst.isFinite = true;
  inst.format = bag.format ?? null;
});
function number2(params) {
  return _number(ZodNumber, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unknownProcessor(inst, ctx, json, params);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
  inst.element = def.element;
  _installLazyMethods(inst, "ZodArray", {
    min(n, params) {
      return this.check(_minLength(n, params));
    },
    nonempty(params) {
      return this.check(_minLength(1, params));
    },
    max(n, params) {
      return this.check(_maxLength(n, params));
    },
    length(n, params) {
      return this.check(_length(n, params));
    },
    unwrap() {
      return this.element;
    }
  });
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
  exports_util.defineLazy(inst, "shape", () => {
    return def.shape;
  });
  _installLazyMethods(inst, "ZodObject", {
    keyof() {
      return _enum(Object.keys(this._zod.def.shape));
    },
    catchall(catchall) {
      return this.clone({ ...this._zod.def, catchall });
    },
    passthrough() {
      return this.clone({ ...this._zod.def, catchall: unknown() });
    },
    loose() {
      return this.clone({ ...this._zod.def, catchall: unknown() });
    },
    strict() {
      return this.clone({ ...this._zod.def, catchall: never() });
    },
    strip() {
      return this.clone({ ...this._zod.def, catchall: undefined });
    },
    extend(incoming) {
      return exports_util.extend(this, incoming);
    },
    safeExtend(incoming) {
      return exports_util.safeExtend(this, incoming);
    },
    merge(other) {
      return exports_util.merge(this, other);
    },
    pick(mask) {
      return exports_util.pick(this, mask);
    },
    omit(mask) {
      return exports_util.omit(this, mask);
    },
    partial(...args) {
      return exports_util.partial(ZodOptional, this, args[0]);
    },
    required(...args) {
      return exports_util.required(ZodNonOptional, this, args[0]);
    }
  });
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...exports_util.normalizeParams(params)
  };
  return new ZodObject(def);
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...exports_util.normalizeParams(params)
  });
}
var ZodDiscriminatedUnion = /* @__PURE__ */ $constructor("ZodDiscriminatedUnion", (inst, def) => {
  ZodUnion.init(inst, def);
  $ZodDiscriminatedUnion.init(inst, def);
});
function discriminatedUnion(discriminator, options, params) {
  return new ZodDiscriminatedUnion({
    type: "union",
    options,
    discriminator,
    ...exports_util.normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodRecord = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
  $ZodRecord.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
  if (!valueType || !valueType._zod) {
    return new ZodRecord({
      type: "record",
      keyType: string2(),
      valueType: keyType,
      ...exports_util.normalizeParams(valueType)
    });
  }
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...exports_util.normalizeParams(params)
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
  inst.enum = def.entries;
  inst.options = Object.values(def.entries);
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...exports_util.normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...exports_util.normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...exports_util.normalizeParams(params)
  });
}
var ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1) {
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      }
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...exports_util.normalizeParams(params)
  });
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(exports_util.issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        _issue.input ?? (_issue.input = payload.value);
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(exports_util.issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output2) => {
        payload.value = output2;
        payload.fallback = true;
        return payload;
      });
    }
    payload.value = output;
    payload.fallback = true;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : exports_util.shallowClone(defaultValue);
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : exports_util.shallowClone(defaultValue);
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...exports_util.normalizeParams(params)
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
  });
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
  });
}
var ZodPreprocess = /* @__PURE__ */ $constructor("ZodPreprocess", (inst, def) => {
  ZodPipe.init(inst, def);
  $ZodPreprocess.init(inst, def);
});
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return _superRefine(fn, params);
}
function preprocess(fn, schema) {
  return new ZodPreprocess({
    type: "pipe",
    in: transform(fn),
    out: schema
  });
}

// ../../omo-config-core/src/schema/reasoning-vocabulary.ts
var REASONING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
var REASONING_AUTO = "auto";
var REASONING_LEVEL_SET = new Set(REASONING_LEVELS);
var REASONING_LEVEL_OR_AUTO_SET = new Set([...REASONING_LEVELS, REASONING_AUTO]);
function isReasoningLevel(value) {
  return REASONING_LEVEL_SET.has(value);
}
function normalizeReasoning(input) {
  const normalized = input.trim().toLowerCase();
  if (!normalized)
    return {};
  if (normalized === "none")
    return { level: "off" };
  if (normalized === REASONING_AUTO)
    return { level: REASONING_AUTO };
  if (isReasoningLevel(normalized))
    return { level: normalized };
  return { passthrough: normalized };
}
function splitReasoningSuffix(model, options) {
  if (typeof model !== "string")
    return { base: "" };
  const trimmed = model.trim();
  if (!trimmed)
    return { base: "" };
  const separatorIndex = trimmed.lastIndexOf(":");
  if (separatorIndex === -1)
    return { base: trimmed };
  const base = trimmed.slice(0, separatorIndex).trim();
  const token = trimmed.slice(separatorIndex + 1).trim().toLowerCase();
  if (!base || !REASONING_LEVEL_OR_AUTO_SET.has(token))
    return { base: trimmed };
  if (token === "max" && !(options?.allowMaxSuffix ?? base.includes("/")))
    return { base: trimmed };
  return { base, level: token };
}

// ../../omo-config-core/src/schema/model-ref.ts
var REASONING_LEVELS_OR_AUTO = [...REASONING_LEVELS, "auto"];
var OmoReasoningSchema = union([
  _enum(REASONING_LEVELS_OR_AUTO),
  string2()
]);
var OmoModelRefObjectSchema = object({
  model: string2(),
  reasoning: OmoReasoningSchema.optional(),
  temperature: number2().min(0).max(2).optional(),
  top_p: number2().min(0).max(1).optional(),
  max_tokens: number2().int().positive().optional(),
  provider_options: record(string2(), unknown()).optional()
}).strict();
var OmoModelRefSchema = union([string2(), OmoModelRefObjectSchema]);

// ../../omo-config-core/src/schema/fallback-models.ts
var OmoThinkingConfigSchema = object({
  type: _enum(["enabled", "disabled"]),
  budgetTokens: number2().optional()
}).strict();
var OmoReasoningEffortSchema = OmoReasoningSchema;
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function canonicalReasoning(value) {
  if (typeof value !== "string")
    return;
  const normalized = normalizeReasoning(value);
  return normalized.level ?? normalized.passthrough;
}
function canonicalModelString(model) {
  const colon = splitReasoningSuffix(model, { allowMaxSuffix: true });
  if (colon.level !== undefined)
    return `${colon.base}:${colon.level}`;
  const trimmed = model.trim();
  const parenthesized = trimmed.match(/^(.*)\(([^()]+)\)\s*$/);
  const spaced = parenthesized === null ? trimmed.match(/^(.*\S)\s+([a-z][a-z0-9_-]*)$/i) : null;
  const base = (parenthesized?.[1] ?? spaced?.[1])?.trim();
  const token = (parenthesized?.[2] ?? spaced?.[2])?.trim();
  if (base === undefined || token === undefined)
    return trimmed;
  const normalized = normalizeReasoning(token);
  return normalized.level === undefined ? trimmed : `${base}:${normalized.level}`;
}
function normalizeLegacyModelFields(entry) {
  const normalized = { ...entry };
  delete normalized["variant"];
  delete normalized["reasoningEffort"];
  delete normalized["thinking"];
  delete normalized["textVerbosity"];
  delete normalized["maxTokens"];
  delete normalized["providerOptions"];
  if (typeof entry["model"] === "string")
    normalized["model"] = canonicalModelString(entry["model"]);
  const explicitReasoning = canonicalReasoning(entry["reasoning"]);
  const variant = canonicalReasoning(entry["variant"]);
  const reasoningEffort = canonicalReasoning(entry["reasoningEffort"]);
  const thinking = isRecord(entry["thinking"]) ? entry["thinking"] : undefined;
  const reasoning = explicitReasoning ?? reasoningEffort ?? variant ?? (thinking?.["type"] === "disabled" ? "off" : undefined);
  if (reasoning !== undefined)
    normalized["reasoning"] = reasoning;
  const providerOptions = isRecord(entry["provider_options"]) ? { ...entry["provider_options"] } : isRecord(entry["providerOptions"]) ? { ...entry["providerOptions"] } : {};
  if (thinking?.["type"] === "enabled")
    providerOptions["thinking"] = { ...thinking };
  if (entry["textVerbosity"] !== undefined)
    providerOptions["textVerbosity"] = entry["textVerbosity"];
  if (Object.keys(providerOptions).length > 0)
    normalized["provider_options"] = providerOptions;
  if (entry["max_tokens"] !== undefined)
    normalized["max_tokens"] = entry["max_tokens"];
  else if (entry["maxTokens"] !== undefined)
    normalized["max_tokens"] = entry["maxTokens"];
  return normalized;
}
var OmoLegacyFallbackModelObjectInputSchema = object({
  model: string2(),
  reasoning: OmoReasoningSchema.optional(),
  temperature: number2().min(0).max(2).optional(),
  top_p: number2().min(0).max(1).optional(),
  max_tokens: number2().int().positive().optional(),
  provider_options: record(string2(), unknown()).optional(),
  variant: string2().optional(),
  reasoningEffort: OmoReasoningEffortSchema.optional(),
  thinking: OmoThinkingConfigSchema.optional(),
  textVerbosity: _enum(["low", "medium", "high"]).optional(),
  maxTokens: number2().optional(),
  providerOptions: record(string2(), unknown()).optional()
}).strict();
var OmoFallbackModelObjectSchema = preprocess((value) => isRecord(value) ? normalizeLegacyModelFields(value) : value, OmoLegacyFallbackModelObjectInputSchema);
var OmoFallbackModelsSchema = union([
  string2(),
  array(string2()),
  array(OmoFallbackModelObjectSchema),
  array(union([string2(), OmoFallbackModelObjectSchema]))
]);

// ../../omo-config-core/src/schema/agent.ts
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var OmoAgentModelEntrySchema = union([string2(), OmoFallbackModelObjectSchema]);
var OmoAgentDefInputSchema = object({
  description: string2().optional(),
  prompt: string2().optional(),
  model: string2().optional(),
  models: array(OmoAgentModelEntrySchema).optional(),
  reasoning: OmoReasoningSchema.optional(),
  variant: string2().optional(),
  reasoningEffort: OmoReasoningEffortSchema.optional(),
  tools: record(string2(), boolean2()).optional(),
  execution_mode: _enum(["in-process", "process"]).optional(),
  background: boolean2().optional(),
  max_depth: number2().int().nonnegative().optional(),
  allowed_subagents: array(string2()).optional(),
  disallowed_tools: array(string2()).optional(),
  max_turns: number2().int().nonnegative().optional(),
  temperature: number2().min(0).max(2).optional(),
  disable: boolean2().optional()
}).strict();
var OmoAgentDefSchema = preprocess((value) => isRecord2(value) ? normalizeLegacyModelFields(value) : value, OmoAgentDefInputSchema);
var OmoAgentsConfigSchema = record(string2(), OmoAgentDefSchema);

// ../../omo-config-core/src/schema/category.ts
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var OmoCategoryConfigObjectSchema = object({
  description: string2().optional(),
  model: string2().optional(),
  models: array(union([string2(), OmoFallbackModelObjectSchema])).optional(),
  reasoning: OmoReasoningSchema.optional(),
  temperature: number2().min(0).max(2).optional(),
  top_p: number2().min(0).max(1).optional(),
  max_tokens: number2().int().positive().optional(),
  provider_options: record(string2(), unknown()).optional(),
  fallback_models: OmoFallbackModelsSchema.optional(),
  variant: string2().optional(),
  maxTokens: number2().optional(),
  thinking: OmoThinkingConfigSchema.optional(),
  reasoningEffort: OmoReasoningEffortSchema.optional(),
  textVerbosity: _enum(["low", "medium", "high"]).optional(),
  tools: record(string2(), boolean2()).optional(),
  prompt_append: string2().optional(),
  max_prompt_tokens: number2().int().positive().optional(),
  is_unstable_agent: boolean2().optional(),
  disable: boolean2().optional(),
  warn_unavailable: boolean2().optional()
}).strict();
var OmoCategoryConfigSchema = preprocess((value) => isRecord3(value) ? normalizeLegacyModelFields(value) : value, OmoCategoryConfigObjectSchema);
var OmoCategoriesConfigSchema = record(string2(), OmoCategoryConfigSchema);

// ../../omo-config-core/src/schema/harness.ts
var HARNESS_IDS = ["codex", "opencode", "omo"];
var OMO_CONFIG_HARNESS_IDS = ["opencode", "senpi", "codex"];
var OmoHarnessIdSchema = _enum(OMO_CONFIG_HARNESS_IDS);

// ../../omo-config-core/src/schema/codegraph.ts
var OmoCodegraphSettingsShape = {
  enabled: boolean2(),
  auto_provision: boolean2(),
  daemon: boolean2(),
  telemetry: boolean2(),
  install_dir: string2().optional(),
  watch_debounce_ms: number2().finite().nonnegative().optional(),
  excluded_roots: array(string2()).optional(),
  session_start_cooldown_ms: number2().finite().min(60000).optional()
};
var OmoCodegraphSettingsLayerSchema = object(OmoCodegraphSettingsShape).partial().strict();
var OmoCodegraphSettingsSchema = OmoCodegraphSettingsLayerSchema.extend({
  enabled: boolean2().default(true),
  auto_provision: boolean2().default(true),
  daemon: boolean2().default(true),
  telemetry: boolean2().default(false)
}).strict();

// ../../omo-config-core/src/schema/git-master.ts
var OmoGitMasterSettingsShape = {
  commit_footer: union([boolean2(), string2()]),
  include_co_authored_by: boolean2()
};
var OmoGitMasterSettingsLayerSchema = object(OmoGitMasterSettingsShape).partial().strict();
var OmoGitMasterSettingsSchema = OmoGitMasterSettingsLayerSchema.extend({
  commit_footer: union([boolean2(), string2()]).default(true),
  include_co_authored_by: boolean2().default(true)
}).strict();

// ../../omo-config-core/src/schema/memory.ts
var OmoMemoryReflectionTriggerSchema = object({
  step_count: number2().int().nonnegative().default(25),
  on_compaction: boolean2().default(true)
}).strict();
var OmoMemoryReflectionSchema = object({
  enabled: boolean2().default(true),
  trigger: OmoMemoryReflectionTriggerSchema.default({ step_count: 25, on_compaction: true }),
  merge: _enum(["auto", "integration"]).default("auto"),
  category: string2().min(1).default("quick"),
  timeout_minutes: number2().int().positive().default(15),
  sandbox: _enum(["auto", "required", "off"]).default("auto")
}).strict();
var OmoMemorySyncSchema = object({
  remote: string2().min(1).optional(),
  enabled: boolean2().default(true)
}).strict();
var OmoMemorySearchSchema = object({
  enabled: boolean2().default(true)
}).strict();
var OmoMemoryRecallSchema = object({
  enabled: boolean2().default(true),
  max_items: number2().int().min(1).max(5).default(2)
}).strict();
var OmoMemoryNudgeSchema = object({
  enabled: boolean2().default(true),
  every_user_turns: number2().int().min(1).default(10)
}).strict();
var OmoMemoryFactsSchema = object({
  enabled: boolean2().default(true),
  debounce_settles: number2().int().min(1).default(4)
}).strict();
var OmoMemoryDreamSchema = object({
  enabled: boolean2().default(true),
  idle_minutes: number2().int().min(0).default(30),
  min_hours_between: number2().int().min(1).default(24),
  shutdown_launch: boolean2().default(true),
  auto_select_max: number2().int().min(1).max(10).default(5),
  auto_select_max_chars: number2().int().min(1e4).default(150000)
}).strict();
var OmoMemoryPeopleSchema = object({
  enabled: boolean2().default(true),
  max_entries: number2().int().min(1).max(100).default(40),
  max_entry_chars: number2().int().min(50).max(500).default(200)
}).strict();
var OmoMemorySoulSchema = object({
  edit_notice: boolean2().default(true)
}).strict();
var OmoMemoryWriteNoticeSchema = object({
  enabled: boolean2().default(true)
}).strict();
var OmoMemoryReflectionTriggerLayerSchema = object({
  step_count: number2().int().nonnegative().optional(),
  on_compaction: boolean2().optional()
}).strict();
var OmoMemoryReflectionLayerSchema = object({
  enabled: boolean2().optional(),
  trigger: OmoMemoryReflectionTriggerLayerSchema.optional(),
  merge: _enum(["auto", "integration"]).optional(),
  category: string2().min(1).optional(),
  timeout_minutes: number2().int().positive().optional(),
  sandbox: _enum(["auto", "required", "off"]).optional()
}).strict();
var OmoMemorySyncLayerSchema = object({
  remote: string2().min(1).optional(),
  enabled: boolean2().optional()
}).strict();
var OmoMemorySearchLayerSchema = object({
  enabled: boolean2().optional()
}).strict();
var OmoMemoryRecallLayerSchema = object({
  enabled: boolean2().optional(),
  max_items: number2().int().min(1).max(5).optional()
}).strict();
var OmoMemoryNudgeLayerSchema = object({
  enabled: boolean2().optional(),
  every_user_turns: number2().int().min(1).optional()
}).strict();
var OmoMemoryFactsLayerSchema = object({
  enabled: boolean2().optional(),
  debounce_settles: number2().int().min(1).optional()
}).strict();
var OmoMemoryDreamLayerSchema = object({
  enabled: boolean2().optional(),
  idle_minutes: number2().int().min(0).optional(),
  min_hours_between: number2().int().min(1).optional(),
  shutdown_launch: boolean2().optional(),
  auto_select_max: number2().int().min(1).max(10).optional(),
  auto_select_max_chars: number2().int().min(1e4).optional()
}).strict();
var OmoMemoryPeopleLayerSchema = object({
  enabled: boolean2().optional(),
  max_entries: number2().int().min(1).max(100).optional(),
  max_entry_chars: number2().int().min(50).max(500).optional()
}).strict();
var OmoMemorySoulLayerSchema = object({
  edit_notice: boolean2().optional()
}).strict();
var OmoMemoryWriteNoticeLayerSchema = object({
  enabled: boolean2().optional()
}).strict();
var OmoMemoryAgentOverridesSchema = object({
  enabled: boolean2().optional(),
  agent: string2().min(1).optional(),
  reflection: OmoMemoryReflectionLayerSchema.optional(),
  nudge: OmoMemoryNudgeLayerSchema.optional(),
  facts: OmoMemoryFactsLayerSchema.optional(),
  dream: OmoMemoryDreamLayerSchema.optional(),
  people: OmoMemoryPeopleLayerSchema.optional(),
  soul: OmoMemorySoulLayerSchema.optional(),
  write_notice: OmoMemoryWriteNoticeLayerSchema.optional(),
  sync: OmoMemorySyncLayerSchema.optional(),
  search: OmoMemorySearchLayerSchema.optional(),
  recall: OmoMemoryRecallLayerSchema.optional(),
  compile_warn_tokens: number2().int().positive().optional()
}).strict();
var OmoMemorySettingsSchema = object({
  enabled: boolean2().default(true),
  agent: string2().min(1).default("auto"),
  tool_exposure: _enum(["direct", "search"]).default("direct"),
  reflection: OmoMemoryReflectionSchema.default({
    enabled: true,
    trigger: { step_count: 25, on_compaction: true },
    merge: "auto",
    category: "quick",
    timeout_minutes: 15,
    sandbox: "auto"
  }),
  nudge: OmoMemoryNudgeSchema.default({ enabled: true, every_user_turns: 10 }),
  facts: OmoMemoryFactsSchema.default({ enabled: true, debounce_settles: 4 }),
  dream: OmoMemoryDreamSchema.default({
    enabled: true,
    idle_minutes: 30,
    min_hours_between: 24,
    shutdown_launch: true,
    auto_select_max: 5,
    auto_select_max_chars: 150000
  }),
  people: OmoMemoryPeopleSchema.default({ enabled: true, max_entries: 40, max_entry_chars: 200 }),
  soul: OmoMemorySoulSchema.default({ edit_notice: true }),
  write_notice: OmoMemoryWriteNoticeSchema.default({ enabled: true }),
  sync: OmoMemorySyncSchema.default({ enabled: true }),
  search: OmoMemorySearchSchema.default({ enabled: true }),
  recall: OmoMemoryRecallSchema.default({ enabled: true, max_items: 2 }),
  compile_warn_tokens: number2().int().positive().default(30000),
  agents: record(string2(), OmoMemoryAgentOverridesSchema).default({})
}).strict();
var OmoMemorySettingsLayerSchema = object({
  enabled: boolean2().optional(),
  agent: string2().min(1).optional(),
  tool_exposure: _enum(["direct", "search"]).optional(),
  reflection: OmoMemoryReflectionLayerSchema.optional(),
  nudge: OmoMemoryNudgeLayerSchema.optional(),
  facts: OmoMemoryFactsLayerSchema.optional(),
  dream: OmoMemoryDreamLayerSchema.optional(),
  people: OmoMemoryPeopleLayerSchema.optional(),
  soul: OmoMemorySoulLayerSchema.optional(),
  write_notice: OmoMemoryWriteNoticeLayerSchema.optional(),
  sync: OmoMemorySyncLayerSchema.optional(),
  search: OmoMemorySearchLayerSchema.optional(),
  recall: OmoMemoryRecallLayerSchema.optional(),
  compile_warn_tokens: number2().int().positive().optional(),
  agents: record(string2(), OmoMemoryAgentOverridesSchema).optional()
}).strict();

// ../../omo-config-core/src/schema/model-catalog.ts
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var OmoModelCatalogEntryInputSchema = object({
  model: string2(),
  reasoning: OmoReasoningSchema.optional(),
  variant: string2().optional(),
  reasoningEffort: OmoReasoningEffortSchema.optional()
}).strict();
var OmoModelCatalogEntrySchema = preprocess((value) => isRecord4(value) ? normalizeLegacyModelFields(value) : value, OmoModelCatalogEntryInputSchema);
var OmoModelCatalogSchema = record(string2(), OmoModelCatalogEntrySchema);
var OmoModelCatalogEntryLayerInputSchema = OmoModelCatalogEntryInputSchema.partial();
var OmoModelCatalogEntryLayerSchema = preprocess((value) => isRecord4(value) ? normalizeLegacyModelFields(value) : value, OmoModelCatalogEntryLayerInputSchema);
var OmoModelCatalogLayerSchema = record(string2(), OmoModelCatalogEntryLayerSchema);

// ../../omo-config-core/src/schema/task.ts
import { availableParallelism } from "node:os";
var DEFAULT_RESIDENCY_MAX_CHILDREN = 16;
var ResidencyMaxChildrenInputSchema = union([number2().int().nonnegative(), literal("unlimited")]);
var OmoTaskWaitSchema = object({
  min_ms: number2().int().positive().default(5000),
  default_ms: number2().int().positive().default(60000),
  max_ms: number2().int().positive().default(600000)
}).strict();
var OmoTaskTeamSettingsSchema = object({
  max_members: number2().int().min(1).max(8).default(8),
  max_parallel_members: number2().int().min(1).max(8).default(4),
  max_wall_clock_minutes: number2().int().positive().default(120)
}).strict();
var OmoTaskWarningsSchema = object({
  unavailable_categories: boolean2().default(true)
}).strict();
var OmoTaskDagSettingsSchema = object({
  max_nodes_per_run: number2().int().positive().default(64),
  max_runs_per_session: number2().int().positive().default(16),
  subscriber_ring: number2().int().positive().default(1000),
  heartbeat_ms: number2().int().positive().default(15000),
  history_default_limit: number2().int().positive().default(256),
  history_max_limit: number2().int().positive().default(1000),
  retention_days: number2().int().positive().default(7),
  max_prompt_bytes: number2().int().positive().default(262144)
}).strict();
var OmoTaskSettingsSchema = object({
  default_execution_mode: _enum(["in-process", "process"]).default("in-process"),
  default_concurrency: number2().int().nonnegative().default(5),
  global_concurrency: number2().int().nonnegative().default(8),
  provider_concurrency: record(string2(), number2().int().nonnegative()).optional(),
  model_concurrency: record(string2(), number2().int().nonnegative()).optional(),
  max_depth: number2().int().nonnegative().default(1),
  residency_max_children: ResidencyMaxChildrenInputSchema.default(8),
  ttl_ms: number2().int().positive().default(86400000),
  state_dir: string2().optional(),
  reattach_on_reconcile: boolean2().optional(),
  resume_children: boolean2().default(true),
  warnings: OmoTaskWarningsSchema.default({ unavailable_categories: true }),
  wait: OmoTaskWaitSchema.default({ min_ms: 5000, default_ms: 60000, max_ms: 600000 }),
  team: OmoTaskTeamSettingsSchema.default({
    max_members: 8,
    max_parallel_members: 4,
    max_wall_clock_minutes: 120
  }),
  dag: OmoTaskDagSettingsSchema.optional()
}).strict();
var OmoTaskDagSettingsLayerSchema = object({
  max_nodes_per_run: number2().int().positive().optional(),
  max_runs_per_session: number2().int().positive().optional(),
  subscriber_ring: number2().int().positive().optional(),
  heartbeat_ms: number2().int().positive().optional(),
  history_default_limit: number2().int().positive().optional(),
  history_max_limit: number2().int().positive().optional(),
  retention_days: number2().int().positive().optional(),
  max_prompt_bytes: number2().int().positive().optional()
}).strict();
var OmoTaskWaitLayerSchema = object({
  min_ms: number2().int().positive().optional(),
  default_ms: number2().int().positive().optional(),
  max_ms: number2().int().positive().optional()
}).strict();
var OmoTaskTeamSettingsLayerSchema = object({
  max_members: number2().int().min(1).max(8).optional(),
  max_parallel_members: number2().int().min(1).max(8).optional(),
  max_wall_clock_minutes: number2().int().positive().optional()
}).strict();
var OmoTaskWarningsLayerSchema = object({
  unavailable_categories: boolean2().optional()
}).strict();
var OmoTaskSettingsLayerSchema = object({
  default_execution_mode: _enum(["in-process", "process"]).optional(),
  default_concurrency: number2().int().nonnegative().optional(),
  global_concurrency: number2().int().nonnegative().optional(),
  provider_concurrency: record(string2(), number2().int().nonnegative()).optional(),
  model_concurrency: record(string2(), number2().int().nonnegative()).optional(),
  max_depth: number2().int().nonnegative().optional(),
  residency_max_children: ResidencyMaxChildrenInputSchema.optional(),
  ttl_ms: number2().int().positive().optional(),
  state_dir: string2().optional(),
  reattach_on_reconcile: boolean2().optional(),
  resume_children: boolean2().optional(),
  warnings: OmoTaskWarningsLayerSchema.optional(),
  wait: OmoTaskWaitLayerSchema.optional(),
  team: OmoTaskTeamSettingsLayerSchema.optional(),
  dag: OmoTaskDagSettingsLayerSchema.optional()
}).strict();
function resolveOmoTaskSettings(input, resolveParallelism = availableParallelism) {
  const record2 = record(string2(), unknown()).parse(input);
  return OmoTaskSettingsSchema.parse({
    ...record2,
    residency_max_children: record2["residency_max_children"] ?? Math.min(DEFAULT_RESIDENCY_MAX_CHILDREN, Math.max(8, resolveParallelism() * 2)),
    global_concurrency: record2["global_concurrency"] ?? Math.max(8, resolveParallelism() * 2)
  });
}

// ../../omo-config-core/src/schema/team.ts
var OmoTeamMemberBaseSchema = object({
  name: string2().min(1).regex(/^[a-z0-9-]+$/),
  cwd: string2().optional(),
  worktreePath: string2().optional(),
  subscriptions: array(string2()).optional(),
  backendType: _enum(["in-process", "tmux"]).default("in-process"),
  color: string2().optional(),
  isActive: boolean2().default(true)
}).strict();
var OmoTeamCategoryMemberSchema = OmoTeamMemberBaseSchema.extend({
  kind: literal("category"),
  category: string2().min(1),
  prompt: string2().min(1)
});
var OmoTeamSubagentMemberSchema = OmoTeamMemberBaseSchema.extend({
  kind: literal("subagent_type"),
  subagent_type: string2().min(1),
  prompt: string2().optional()
});
var OmoTeamMemberSchema = discriminatedUnion("kind", [
  OmoTeamCategoryMemberSchema,
  OmoTeamSubagentMemberSchema
]);
var OmoTeamSpecBaseSchema = object({
  version: literal(1).default(1),
  name: string2().min(1).regex(/^[a-z0-9-]+$/).optional(),
  description: string2().optional(),
  createdAt: number2().int().positive().optional(),
  leadAgentId: string2().optional(),
  teamAllowedPaths: array(string2()).optional(),
  sessionPermission: string2().optional(),
  members: array(OmoTeamMemberSchema).min(1).max(8)
}).strict();
var OmoTeamSpecSchema = OmoTeamSpecBaseSchema.superRefine((teamSpec, ctx) => {
  if (teamSpec.leadAgentId === undefined && teamSpec.members.length > 1) {
    ctx.addIssue({
      code: "custom",
      message: "leadAgentId required when a team has multiple members",
      path: ["leadAgentId"]
    });
  }
});
var OmoTeamSpecLayerSchema = OmoTeamSpecBaseSchema.partial();
var OmoTeamsConfigSchema = record(string2(), OmoTeamSpecSchema);
var OmoTeamsConfigLayerSchema = record(string2(), OmoTeamSpecLayerSchema);

// ../../omo-config-core/src/schema/telemetry.ts
var OmoTelemetrySettingsShape = {
  enabled: boolean2()
};
var OmoTelemetrySettingsLayerSchema = object(OmoTelemetrySettingsShape).partial().strict();
var OmoTelemetrySettingsSchema = OmoTelemetrySettingsLayerSchema.extend({
  enabled: boolean2().default(true)
}).strict();

// ../../omo-config-core/src/schema/format-on-mutation.ts
var mode = _enum(["off", "best-effort", "required"]);
var languages = record(string2(), boolean2()).optional();
var OmoFormatOnMutationLayerSchema = object({
  mode: mode.optional(),
  languages,
  maxFileBytes: number2().int().positive().optional(),
  timeoutMs: number2().int().positive().optional()
}).strict();
var OmoFormatOnMutationSchema = OmoFormatOnMutationLayerSchema.extend({
  mode: mode.default("best-effort"),
  maxFileBytes: number2().int().positive().default(1048576),
  timeoutMs: number2().int().positive().default(3000)
}).strict();

// ../../omo-config-core/src/schema/config.ts
var OmoOpenCodeHarnessConfigSchema = record(string2(), unknown());
var OmoTypedHarnessConfigSchema = object({
  formatOnMutation: OmoFormatOnMutationLayerSchema.optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  codegraph: OmoCodegraphSettingsLayerSchema.optional(),
  git_master: OmoGitMasterSettingsLayerSchema.optional(),
  task: OmoTaskSettingsLayerSchema.optional(),
  teams: OmoTeamsConfigLayerSchema.optional(),
  models: OmoModelCatalogLayerSchema.optional(),
  memory: OmoMemorySettingsLayerSchema.optional(),
  telemetry: OmoTelemetrySettingsLayerSchema.optional()
}).strict();
var OmoConfigProfileSchema = object({
  formatOnMutation: OmoFormatOnMutationLayerSchema.optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  codegraph: OmoCodegraphSettingsLayerSchema.optional(),
  git_master: OmoGitMasterSettingsLayerSchema.optional(),
  task: OmoTaskSettingsLayerSchema.optional(),
  teams: OmoTeamsConfigLayerSchema.optional(),
  models: OmoModelCatalogLayerSchema.optional(),
  memory: OmoMemorySettingsLayerSchema.optional(),
  telemetry: OmoTelemetrySettingsLayerSchema.optional(),
  "[opencode]": OmoOpenCodeHarnessConfigSchema.optional(),
  "[senpi]": OmoTypedHarnessConfigSchema.optional(),
  "[codex]": OmoTypedHarnessConfigSchema.optional()
}).strict();
var OmoConfigSchema = object({
  formatOnMutation: OmoFormatOnMutationSchema.optional(),
  $schema: string2().optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  codegraph: OmoCodegraphSettingsSchema.optional(),
  git_master: OmoGitMasterSettingsSchema.optional(),
  task: OmoTaskSettingsSchema.optional(),
  teams: OmoTeamsConfigSchema.optional(),
  models: OmoModelCatalogSchema.optional(),
  memory: OmoMemorySettingsSchema.optional(),
  telemetry: OmoTelemetrySettingsSchema.optional(),
  "[opencode]": OmoOpenCodeHarnessConfigSchema.optional(),
  "[senpi]": OmoTypedHarnessConfigSchema.optional(),
  "[codex]": OmoTypedHarnessConfigSchema.optional(),
  profiles: record(string2(), OmoConfigProfileSchema).default({}),
  _migrations: array(string2()).optional(),
  legacy_migrations: record(string2(), unknown()).optional()
}).strict();
var OmoConfigLayerSchema = object({
  formatOnMutation: OmoFormatOnMutationLayerSchema.optional(),
  $schema: string2().optional(),
  categories: OmoCategoriesConfigSchema.optional(),
  agents: OmoAgentsConfigSchema.optional(),
  codegraph: OmoCodegraphSettingsLayerSchema.optional(),
  git_master: OmoGitMasterSettingsLayerSchema.optional(),
  task: OmoTaskSettingsLayerSchema.optional(),
  teams: OmoTeamsConfigLayerSchema.optional(),
  models: OmoModelCatalogLayerSchema.optional(),
  memory: OmoMemorySettingsLayerSchema.optional(),
  telemetry: OmoTelemetrySettingsLayerSchema.optional(),
  "[opencode]": OmoOpenCodeHarnessConfigSchema.optional(),
  "[senpi]": OmoTypedHarnessConfigSchema.optional(),
  "[codex]": OmoTypedHarnessConfigSchema.optional(),
  profiles: record(string2(), OmoConfigProfileSchema).optional(),
  _migrations: array(string2()).optional(),
  legacy_migrations: record(string2(), unknown()).optional()
}).strict();

// ../../../node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/scanner.js
function createScanner(text, ignoreTrivia = false) {
  const len = text.length;
  let pos = 0, value = "", tokenOffset = 0, token = 16, lineNumber = 0, lineStartOffset = 0, tokenLineStartOffset = 0, prevTokenLineStartOffset = 0, scanError = 0;
  function scanHexDigits(count, exact) {
    let digits = 0;
    let value2 = 0;
    while (digits < count || !exact) {
      let ch = text.charCodeAt(pos);
      if (ch >= 48 && ch <= 57) {
        value2 = value2 * 16 + ch - 48;
      } else if (ch >= 65 && ch <= 70) {
        value2 = value2 * 16 + ch - 65 + 10;
      } else if (ch >= 97 && ch <= 102) {
        value2 = value2 * 16 + ch - 97 + 10;
      } else {
        break;
      }
      pos++;
      digits++;
    }
    if (digits < count) {
      value2 = -1;
    }
    return value2;
  }
  function setPosition(newPosition) {
    pos = newPosition;
    value = "";
    tokenOffset = 0;
    token = 16;
    scanError = 0;
  }
  function scanNumber() {
    let start = pos;
    if (text.charCodeAt(pos) === 48) {
      pos++;
    } else {
      pos++;
      while (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
      }
    }
    if (pos < text.length && text.charCodeAt(pos) === 46) {
      pos++;
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
      } else {
        scanError = 3;
        return text.substring(start, pos);
      }
    }
    let end = pos;
    if (pos < text.length && (text.charCodeAt(pos) === 69 || text.charCodeAt(pos) === 101)) {
      pos++;
      if (pos < text.length && text.charCodeAt(pos) === 43 || text.charCodeAt(pos) === 45) {
        pos++;
      }
      if (pos < text.length && isDigit(text.charCodeAt(pos))) {
        pos++;
        while (pos < text.length && isDigit(text.charCodeAt(pos))) {
          pos++;
        }
        end = pos;
      } else {
        scanError = 3;
      }
    }
    return text.substring(start, end);
  }
  function scanString() {
    let result = "", start = pos;
    while (true) {
      if (pos >= len) {
        result += text.substring(start, pos);
        scanError = 2;
        break;
      }
      const ch = text.charCodeAt(pos);
      if (ch === 34) {
        result += text.substring(start, pos);
        pos++;
        break;
      }
      if (ch === 92) {
        result += text.substring(start, pos);
        pos++;
        if (pos >= len) {
          scanError = 2;
          break;
        }
        const ch2 = text.charCodeAt(pos++);
        switch (ch2) {
          case 34:
            result += '"';
            break;
          case 92:
            result += "\\";
            break;
          case 47:
            result += "/";
            break;
          case 98:
            result += "\b";
            break;
          case 102:
            result += "\f";
            break;
          case 110:
            result += `
`;
            break;
          case 114:
            result += "\r";
            break;
          case 116:
            result += "\t";
            break;
          case 117:
            const ch3 = scanHexDigits(4, true);
            if (ch3 >= 0) {
              result += String.fromCharCode(ch3);
            } else {
              scanError = 4;
            }
            break;
          default:
            scanError = 5;
        }
        start = pos;
        continue;
      }
      if (ch >= 0 && ch <= 31) {
        if (isLineBreak(ch)) {
          result += text.substring(start, pos);
          scanError = 2;
          break;
        } else {
          scanError = 6;
        }
      }
      pos++;
    }
    return result;
  }
  function scanNext() {
    value = "";
    scanError = 0;
    tokenOffset = pos;
    lineStartOffset = lineNumber;
    prevTokenLineStartOffset = tokenLineStartOffset;
    if (pos >= len) {
      tokenOffset = len;
      return token = 17;
    }
    let code = text.charCodeAt(pos);
    if (isWhiteSpace(code)) {
      do {
        pos++;
        value += String.fromCharCode(code);
        code = text.charCodeAt(pos);
      } while (isWhiteSpace(code));
      return token = 15;
    }
    if (isLineBreak(code)) {
      pos++;
      value += String.fromCharCode(code);
      if (code === 13 && text.charCodeAt(pos) === 10) {
        pos++;
        value += `
`;
      }
      lineNumber++;
      tokenLineStartOffset = pos;
      return token = 14;
    }
    switch (code) {
      case 123:
        pos++;
        return token = 1;
      case 125:
        pos++;
        return token = 2;
      case 91:
        pos++;
        return token = 3;
      case 93:
        pos++;
        return token = 4;
      case 58:
        pos++;
        return token = 6;
      case 44:
        pos++;
        return token = 5;
      case 34:
        pos++;
        value = scanString();
        return token = 10;
      case 47:
        const start = pos - 1;
        if (text.charCodeAt(pos + 1) === 47) {
          pos += 2;
          while (pos < len) {
            if (isLineBreak(text.charCodeAt(pos))) {
              break;
            }
            pos++;
          }
          value = text.substring(start, pos);
          return token = 12;
        }
        if (text.charCodeAt(pos + 1) === 42) {
          pos += 2;
          const safeLength = len - 1;
          let commentClosed = false;
          while (pos < safeLength) {
            const ch = text.charCodeAt(pos);
            if (ch === 42 && text.charCodeAt(pos + 1) === 47) {
              pos += 2;
              commentClosed = true;
              break;
            }
            pos++;
            if (isLineBreak(ch)) {
              if (ch === 13 && text.charCodeAt(pos) === 10) {
                pos++;
              }
              lineNumber++;
              tokenLineStartOffset = pos;
            }
          }
          if (!commentClosed) {
            pos++;
            scanError = 1;
          }
          value = text.substring(start, pos);
          return token = 13;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
      case 45:
        value += String.fromCharCode(code);
        pos++;
        if (pos === len || !isDigit(text.charCodeAt(pos))) {
          return token = 16;
        }
      case 48:
      case 49:
      case 50:
      case 51:
      case 52:
      case 53:
      case 54:
      case 55:
      case 56:
      case 57:
        value += scanNumber();
        return token = 11;
      default:
        while (pos < len && isUnknownContentCharacter(code)) {
          pos++;
          code = text.charCodeAt(pos);
        }
        if (tokenOffset !== pos) {
          value = text.substring(tokenOffset, pos);
          switch (value) {
            case "true":
              return token = 8;
            case "false":
              return token = 9;
            case "null":
              return token = 7;
          }
          return token = 16;
        }
        value += String.fromCharCode(code);
        pos++;
        return token = 16;
    }
  }
  function isUnknownContentCharacter(code) {
    if (isWhiteSpace(code) || isLineBreak(code)) {
      return false;
    }
    switch (code) {
      case 125:
      case 93:
      case 123:
      case 91:
      case 34:
      case 58:
      case 44:
      case 47:
        return false;
    }
    return true;
  }
  function scanNextNonTrivia() {
    let result;
    do {
      result = scanNext();
    } while (result >= 12 && result <= 15);
    return result;
  }
  return {
    setPosition,
    getPosition: () => pos,
    scan: ignoreTrivia ? scanNextNonTrivia : scanNext,
    getToken: () => token,
    getTokenValue: () => value,
    getTokenOffset: () => tokenOffset,
    getTokenLength: () => pos - tokenOffset,
    getTokenStartLine: () => lineStartOffset,
    getTokenStartCharacter: () => tokenOffset - prevTokenLineStartOffset,
    getTokenError: () => scanError
  };
}
function isWhiteSpace(ch) {
  return ch === 32 || ch === 9;
}
function isLineBreak(ch) {
  return ch === 10 || ch === 13;
}
function isDigit(ch) {
  return ch >= 48 && ch <= 57;
}
var CharacterCodes;
(function(CharacterCodes2) {
  CharacterCodes2[CharacterCodes2["lineFeed"] = 10] = "lineFeed";
  CharacterCodes2[CharacterCodes2["carriageReturn"] = 13] = "carriageReturn";
  CharacterCodes2[CharacterCodes2["space"] = 32] = "space";
  CharacterCodes2[CharacterCodes2["_0"] = 48] = "_0";
  CharacterCodes2[CharacterCodes2["_1"] = 49] = "_1";
  CharacterCodes2[CharacterCodes2["_2"] = 50] = "_2";
  CharacterCodes2[CharacterCodes2["_3"] = 51] = "_3";
  CharacterCodes2[CharacterCodes2["_4"] = 52] = "_4";
  CharacterCodes2[CharacterCodes2["_5"] = 53] = "_5";
  CharacterCodes2[CharacterCodes2["_6"] = 54] = "_6";
  CharacterCodes2[CharacterCodes2["_7"] = 55] = "_7";
  CharacterCodes2[CharacterCodes2["_8"] = 56] = "_8";
  CharacterCodes2[CharacterCodes2["_9"] = 57] = "_9";
  CharacterCodes2[CharacterCodes2["a"] = 97] = "a";
  CharacterCodes2[CharacterCodes2["b"] = 98] = "b";
  CharacterCodes2[CharacterCodes2["c"] = 99] = "c";
  CharacterCodes2[CharacterCodes2["d"] = 100] = "d";
  CharacterCodes2[CharacterCodes2["e"] = 101] = "e";
  CharacterCodes2[CharacterCodes2["f"] = 102] = "f";
  CharacterCodes2[CharacterCodes2["g"] = 103] = "g";
  CharacterCodes2[CharacterCodes2["h"] = 104] = "h";
  CharacterCodes2[CharacterCodes2["i"] = 105] = "i";
  CharacterCodes2[CharacterCodes2["j"] = 106] = "j";
  CharacterCodes2[CharacterCodes2["k"] = 107] = "k";
  CharacterCodes2[CharacterCodes2["l"] = 108] = "l";
  CharacterCodes2[CharacterCodes2["m"] = 109] = "m";
  CharacterCodes2[CharacterCodes2["n"] = 110] = "n";
  CharacterCodes2[CharacterCodes2["o"] = 111] = "o";
  CharacterCodes2[CharacterCodes2["p"] = 112] = "p";
  CharacterCodes2[CharacterCodes2["q"] = 113] = "q";
  CharacterCodes2[CharacterCodes2["r"] = 114] = "r";
  CharacterCodes2[CharacterCodes2["s"] = 115] = "s";
  CharacterCodes2[CharacterCodes2["t"] = 116] = "t";
  CharacterCodes2[CharacterCodes2["u"] = 117] = "u";
  CharacterCodes2[CharacterCodes2["v"] = 118] = "v";
  CharacterCodes2[CharacterCodes2["w"] = 119] = "w";
  CharacterCodes2[CharacterCodes2["x"] = 120] = "x";
  CharacterCodes2[CharacterCodes2["y"] = 121] = "y";
  CharacterCodes2[CharacterCodes2["z"] = 122] = "z";
  CharacterCodes2[CharacterCodes2["A"] = 65] = "A";
  CharacterCodes2[CharacterCodes2["B"] = 66] = "B";
  CharacterCodes2[CharacterCodes2["C"] = 67] = "C";
  CharacterCodes2[CharacterCodes2["D"] = 68] = "D";
  CharacterCodes2[CharacterCodes2["E"] = 69] = "E";
  CharacterCodes2[CharacterCodes2["F"] = 70] = "F";
  CharacterCodes2[CharacterCodes2["G"] = 71] = "G";
  CharacterCodes2[CharacterCodes2["H"] = 72] = "H";
  CharacterCodes2[CharacterCodes2["I"] = 73] = "I";
  CharacterCodes2[CharacterCodes2["J"] = 74] = "J";
  CharacterCodes2[CharacterCodes2["K"] = 75] = "K";
  CharacterCodes2[CharacterCodes2["L"] = 76] = "L";
  CharacterCodes2[CharacterCodes2["M"] = 77] = "M";
  CharacterCodes2[CharacterCodes2["N"] = 78] = "N";
  CharacterCodes2[CharacterCodes2["O"] = 79] = "O";
  CharacterCodes2[CharacterCodes2["P"] = 80] = "P";
  CharacterCodes2[CharacterCodes2["Q"] = 81] = "Q";
  CharacterCodes2[CharacterCodes2["R"] = 82] = "R";
  CharacterCodes2[CharacterCodes2["S"] = 83] = "S";
  CharacterCodes2[CharacterCodes2["T"] = 84] = "T";
  CharacterCodes2[CharacterCodes2["U"] = 85] = "U";
  CharacterCodes2[CharacterCodes2["V"] = 86] = "V";
  CharacterCodes2[CharacterCodes2["W"] = 87] = "W";
  CharacterCodes2[CharacterCodes2["X"] = 88] = "X";
  CharacterCodes2[CharacterCodes2["Y"] = 89] = "Y";
  CharacterCodes2[CharacterCodes2["Z"] = 90] = "Z";
  CharacterCodes2[CharacterCodes2["asterisk"] = 42] = "asterisk";
  CharacterCodes2[CharacterCodes2["backslash"] = 92] = "backslash";
  CharacterCodes2[CharacterCodes2["closeBrace"] = 125] = "closeBrace";
  CharacterCodes2[CharacterCodes2["closeBracket"] = 93] = "closeBracket";
  CharacterCodes2[CharacterCodes2["colon"] = 58] = "colon";
  CharacterCodes2[CharacterCodes2["comma"] = 44] = "comma";
  CharacterCodes2[CharacterCodes2["dot"] = 46] = "dot";
  CharacterCodes2[CharacterCodes2["doubleQuote"] = 34] = "doubleQuote";
  CharacterCodes2[CharacterCodes2["minus"] = 45] = "minus";
  CharacterCodes2[CharacterCodes2["openBrace"] = 123] = "openBrace";
  CharacterCodes2[CharacterCodes2["openBracket"] = 91] = "openBracket";
  CharacterCodes2[CharacterCodes2["plus"] = 43] = "plus";
  CharacterCodes2[CharacterCodes2["slash"] = 47] = "slash";
  CharacterCodes2[CharacterCodes2["formFeed"] = 12] = "formFeed";
  CharacterCodes2[CharacterCodes2["tab"] = 9] = "tab";
})(CharacterCodes || (CharacterCodes = {}));

// ../../../node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/string-intern.js
var cachedSpaces = new Array(20).fill(0).map((_, index) => {
  return " ".repeat(index);
});
var maxCachedValues = 200;
var cachedBreakLinesWithSpaces = {
  " ": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `
` + " ".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + " ".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `\r
` + " ".repeat(index);
    })
  },
  "\t": {
    "\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `
` + "\t".repeat(index);
    }),
    "\r": new Array(maxCachedValues).fill(0).map((_, index) => {
      return "\r" + "\t".repeat(index);
    }),
    "\r\n": new Array(maxCachedValues).fill(0).map((_, index) => {
      return `\r
` + "\t".repeat(index);
    })
  }
};
var supportedEols = [`
`, "\r", `\r
`];

// ../../../node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/format.js
function format(documentText, range, options) {
  let initialIndentLevel;
  let formatText;
  let formatTextStart;
  let rangeStart;
  let rangeEnd;
  if (range) {
    rangeStart = range.offset;
    rangeEnd = rangeStart + range.length;
    formatTextStart = rangeStart;
    while (formatTextStart > 0 && !isEOL(documentText, formatTextStart - 1)) {
      formatTextStart--;
    }
    let endOffset = rangeEnd;
    while (endOffset < documentText.length && !isEOL(documentText, endOffset)) {
      endOffset++;
    }
    formatText = documentText.substring(formatTextStart, endOffset);
    initialIndentLevel = computeIndentLevel(formatText, options);
  } else {
    formatText = documentText;
    initialIndentLevel = 0;
    formatTextStart = 0;
    rangeStart = 0;
    rangeEnd = documentText.length;
  }
  const eol = getEOL(options, documentText);
  const eolFastPathSupported = supportedEols.includes(eol);
  let numberLineBreaks = 0;
  let indentLevel = 0;
  let indentValue;
  if (options.insertSpaces) {
    indentValue = cachedSpaces[options.tabSize || 4] ?? repeat(cachedSpaces[1], options.tabSize || 4);
  } else {
    indentValue = "\t";
  }
  const indentType = indentValue === "\t" ? "\t" : " ";
  let scanner = createScanner(formatText, false);
  let hasError = false;
  function newLinesAndIndent() {
    if (numberLineBreaks > 1) {
      return repeat(eol, numberLineBreaks) + repeat(indentValue, initialIndentLevel + indentLevel);
    }
    const amountOfSpaces = indentValue.length * (initialIndentLevel + indentLevel);
    if (!eolFastPathSupported || amountOfSpaces > cachedBreakLinesWithSpaces[indentType][eol].length) {
      return eol + repeat(indentValue, initialIndentLevel + indentLevel);
    }
    if (amountOfSpaces <= 0) {
      return eol;
    }
    return cachedBreakLinesWithSpaces[indentType][eol][amountOfSpaces];
  }
  function scanNext() {
    let token = scanner.scan();
    numberLineBreaks = 0;
    while (token === 15 || token === 14) {
      if (token === 14 && options.keepLines) {
        numberLineBreaks += 1;
      } else if (token === 14) {
        numberLineBreaks = 1;
      }
      token = scanner.scan();
    }
    hasError = token === 16 || scanner.getTokenError() !== 0;
    return token;
  }
  const editOperations = [];
  function addEdit(text, startOffset, endOffset) {
    if (!hasError && (!range || startOffset < rangeEnd && endOffset > rangeStart) && documentText.substring(startOffset, endOffset) !== text) {
      editOperations.push({ offset: startOffset, length: endOffset - startOffset, content: text });
    }
  }
  let firstToken = scanNext();
  if (options.keepLines && numberLineBreaks > 0) {
    addEdit(repeat(eol, numberLineBreaks), 0, 0);
  }
  if (firstToken !== 17) {
    let firstTokenStart = scanner.getTokenOffset() + formatTextStart;
    let initialIndent = indentValue.length * initialIndentLevel < 20 && options.insertSpaces ? cachedSpaces[indentValue.length * initialIndentLevel] : repeat(indentValue, initialIndentLevel);
    addEdit(initialIndent, formatTextStart, firstTokenStart);
  }
  while (firstToken !== 17) {
    let firstTokenEnd = scanner.getTokenOffset() + scanner.getTokenLength() + formatTextStart;
    let secondToken = scanNext();
    let replaceContent = "";
    let needsLineBreak = false;
    while (numberLineBreaks === 0 && (secondToken === 12 || secondToken === 13)) {
      let commentTokenStart = scanner.getTokenOffset() + formatTextStart;
      addEdit(cachedSpaces[1], firstTokenEnd, commentTokenStart);
      firstTokenEnd = scanner.getTokenOffset() + scanner.getTokenLength() + formatTextStart;
      needsLineBreak = secondToken === 12;
      replaceContent = needsLineBreak ? newLinesAndIndent() : "";
      secondToken = scanNext();
    }
    if (secondToken === 2) {
      if (firstToken !== 1) {
        indentLevel--;
      }
      if (options.keepLines && numberLineBreaks > 0 || !options.keepLines && firstToken !== 1) {
        replaceContent = newLinesAndIndent();
      } else if (options.keepLines) {
        replaceContent = cachedSpaces[1];
      }
    } else if (secondToken === 4) {
      if (firstToken !== 3) {
        indentLevel--;
      }
      if (options.keepLines && numberLineBreaks > 0 || !options.keepLines && firstToken !== 3) {
        replaceContent = newLinesAndIndent();
      } else if (options.keepLines) {
        replaceContent = cachedSpaces[1];
      }
    } else {
      switch (firstToken) {
        case 3:
        case 1:
          indentLevel++;
          if (options.keepLines && numberLineBreaks > 0 || !options.keepLines) {
            replaceContent = newLinesAndIndent();
          } else {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 5:
          if (options.keepLines && numberLineBreaks > 0 || !options.keepLines) {
            replaceContent = newLinesAndIndent();
          } else {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 12:
          replaceContent = newLinesAndIndent();
          break;
        case 13:
          if (numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else if (!needsLineBreak) {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 6:
          if (options.keepLines && numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else if (!needsLineBreak) {
            replaceContent = cachedSpaces[1];
          }
          break;
        case 10:
          if (options.keepLines && numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else if (secondToken === 6 && !needsLineBreak) {
            replaceContent = "";
          }
          break;
        case 7:
        case 8:
        case 9:
        case 11:
        case 2:
        case 4:
          if (options.keepLines && numberLineBreaks > 0) {
            replaceContent = newLinesAndIndent();
          } else {
            if ((secondToken === 12 || secondToken === 13) && !needsLineBreak) {
              replaceContent = cachedSpaces[1];
            } else if (secondToken !== 5 && secondToken !== 17) {
              hasError = true;
            }
          }
          break;
        case 16:
          hasError = true;
          break;
      }
      if (numberLineBreaks > 0 && (secondToken === 12 || secondToken === 13)) {
        replaceContent = newLinesAndIndent();
      }
    }
    if (secondToken === 17) {
      if (options.keepLines && numberLineBreaks > 0) {
        replaceContent = newLinesAndIndent();
      } else {
        replaceContent = options.insertFinalNewline ? eol : "";
      }
    }
    const secondTokenStart = scanner.getTokenOffset() + formatTextStart;
    addEdit(replaceContent, firstTokenEnd, secondTokenStart);
    firstToken = secondToken;
  }
  return editOperations;
}
function repeat(s, count) {
  let result = "";
  for (let i = 0;i < count; i++) {
    result += s;
  }
  return result;
}
function computeIndentLevel(content, options) {
  let i = 0;
  let nChars = 0;
  const tabSize = options.tabSize || 4;
  while (i < content.length) {
    let ch = content.charAt(i);
    if (ch === cachedSpaces[1]) {
      nChars++;
    } else if (ch === "\t") {
      nChars += tabSize;
    } else {
      break;
    }
    i++;
  }
  return Math.floor(nChars / tabSize);
}
function getEOL(options, text) {
  for (let i = 0;i < text.length; i++) {
    const ch = text.charAt(i);
    if (ch === "\r") {
      if (i + 1 < text.length && text.charAt(i + 1) === `
`) {
        return `\r
`;
      }
      return "\r";
    } else if (ch === `
`) {
      return `
`;
    }
  }
  return options && options.eol || `
`;
}
function isEOL(text, offset) {
  return `\r
`.indexOf(text.charAt(offset)) !== -1;
}

// ../../../node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/parser.js
var ParseOptions;
(function(ParseOptions2) {
  ParseOptions2.DEFAULT = {
    allowTrailingComma: false
  };
})(ParseOptions || (ParseOptions = {}));
function parse4(text, errors2 = [], options = ParseOptions.DEFAULT) {
  let currentProperty = null;
  let currentParent = [];
  const previousParents = [];
  function onValue(value) {
    if (Array.isArray(currentParent)) {
      currentParent.push(value);
    } else if (currentProperty !== null) {
      currentParent[currentProperty] = value;
    }
  }
  const visitor = {
    onObjectBegin: () => {
      const object2 = {};
      onValue(object2);
      previousParents.push(currentParent);
      currentParent = object2;
      currentProperty = null;
    },
    onObjectProperty: (name) => {
      currentProperty = name;
    },
    onObjectEnd: () => {
      currentParent = previousParents.pop();
    },
    onArrayBegin: () => {
      const array2 = [];
      onValue(array2);
      previousParents.push(currentParent);
      currentParent = array2;
      currentProperty = null;
    },
    onArrayEnd: () => {
      currentParent = previousParents.pop();
    },
    onLiteralValue: onValue,
    onError: (error, offset, length) => {
      errors2.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  return currentParent[0];
}
function parseTree(text, errors2 = [], options = ParseOptions.DEFAULT) {
  let currentParent = { type: "array", offset: -1, length: -1, children: [], parent: undefined };
  function ensurePropertyComplete(endOffset) {
    if (currentParent.type === "property") {
      currentParent.length = endOffset - currentParent.offset;
      currentParent = currentParent.parent;
    }
  }
  function onValue(valueNode) {
    currentParent.children.push(valueNode);
    return valueNode;
  }
  const visitor = {
    onObjectBegin: (offset) => {
      currentParent = onValue({ type: "object", offset, length: -1, parent: currentParent, children: [] });
    },
    onObjectProperty: (name, offset, length) => {
      currentParent = onValue({ type: "property", offset, length: -1, parent: currentParent, children: [] });
      currentParent.children.push({ type: "string", value: name, offset, length, parent: currentParent });
    },
    onObjectEnd: (offset, length) => {
      ensurePropertyComplete(offset + length);
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onArrayBegin: (offset, length) => {
      currentParent = onValue({ type: "array", offset, length: -1, parent: currentParent, children: [] });
    },
    onArrayEnd: (offset, length) => {
      currentParent.length = offset + length - currentParent.offset;
      currentParent = currentParent.parent;
      ensurePropertyComplete(offset + length);
    },
    onLiteralValue: (value, offset, length) => {
      onValue({ type: getNodeType(value), offset, length, parent: currentParent, value });
      ensurePropertyComplete(offset + length);
    },
    onSeparator: (sep, offset, length) => {
      if (currentParent.type === "property") {
        if (sep === ":") {
          currentParent.colonOffset = offset;
        } else if (sep === ",") {
          ensurePropertyComplete(offset);
        }
      }
    },
    onError: (error, offset, length) => {
      errors2.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  const result = currentParent.children[0];
  if (result) {
    delete result.parent;
  }
  return result;
}
function findNodeAtLocation(root, path) {
  if (!root) {
    return;
  }
  let node = root;
  for (let segment of path) {
    if (typeof segment === "string") {
      if (node.type !== "object" || !Array.isArray(node.children)) {
        return;
      }
      let found = false;
      for (const propertyNode of node.children) {
        if (Array.isArray(propertyNode.children) && propertyNode.children[0].value === segment && propertyNode.children.length === 2) {
          node = propertyNode.children[1];
          found = true;
          break;
        }
      }
      if (!found) {
        return;
      }
    } else {
      const index = segment;
      if (node.type !== "array" || index < 0 || !Array.isArray(node.children) || index >= node.children.length) {
        return;
      }
      node = node.children[index];
    }
  }
  return node;
}
function visit(text, visitor, options = ParseOptions.DEFAULT) {
  const _scanner = createScanner(text, false);
  const _jsonPath = [];
  let suppressedCallbacks = 0;
  function toNoArgVisit(visitFunction) {
    return visitFunction ? () => suppressedCallbacks === 0 && visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisit(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter()) : () => true;
  }
  function toOneArgVisitWithPath(visitFunction) {
    return visitFunction ? (arg) => suppressedCallbacks === 0 && visitFunction(arg, _scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice()) : () => true;
  }
  function toBeginVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks++;
      } else {
        let cbReturn = visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter(), () => _jsonPath.slice());
        if (cbReturn === false) {
          suppressedCallbacks = 1;
        }
      }
    } : () => true;
  }
  function toEndVisit(visitFunction) {
    return visitFunction ? () => {
      if (suppressedCallbacks > 0) {
        suppressedCallbacks--;
      }
      if (suppressedCallbacks === 0) {
        visitFunction(_scanner.getTokenOffset(), _scanner.getTokenLength(), _scanner.getTokenStartLine(), _scanner.getTokenStartCharacter());
      }
    } : () => true;
  }
  const onObjectBegin = toBeginVisit(visitor.onObjectBegin), onObjectProperty = toOneArgVisitWithPath(visitor.onObjectProperty), onObjectEnd = toEndVisit(visitor.onObjectEnd), onArrayBegin = toBeginVisit(visitor.onArrayBegin), onArrayEnd = toEndVisit(visitor.onArrayEnd), onLiteralValue = toOneArgVisitWithPath(visitor.onLiteralValue), onSeparator = toOneArgVisit(visitor.onSeparator), onComment = toNoArgVisit(visitor.onComment), onError = toOneArgVisit(visitor.onError);
  const disallowComments = options && options.disallowComments;
  const allowTrailingComma = options && options.allowTrailingComma;
  function scanNext() {
    while (true) {
      const token = _scanner.scan();
      switch (_scanner.getTokenError()) {
        case 4:
          handleError(14);
          break;
        case 5:
          handleError(15);
          break;
        case 3:
          handleError(13);
          break;
        case 1:
          if (!disallowComments) {
            handleError(11);
          }
          break;
        case 2:
          handleError(12);
          break;
        case 6:
          handleError(16);
          break;
      }
      switch (token) {
        case 12:
        case 13:
          if (disallowComments) {
            handleError(10);
          } else {
            onComment();
          }
          break;
        case 16:
          handleError(1);
          break;
        case 15:
        case 14:
          break;
        default:
          return token;
      }
    }
  }
  function handleError(error, skipUntilAfter = [], skipUntil = []) {
    onError(error);
    if (skipUntilAfter.length + skipUntil.length > 0) {
      let token = _scanner.getToken();
      while (token !== 17) {
        if (skipUntilAfter.indexOf(token) !== -1) {
          scanNext();
          break;
        } else if (skipUntil.indexOf(token) !== -1) {
          break;
        }
        token = scanNext();
      }
    }
  }
  function parseString(isValue) {
    const value = _scanner.getTokenValue();
    if (isValue) {
      onLiteralValue(value);
    } else {
      onObjectProperty(value);
      _jsonPath.push(value);
    }
    scanNext();
    return true;
  }
  function parseLiteral() {
    switch (_scanner.getToken()) {
      case 11:
        const tokenValue = _scanner.getTokenValue();
        let value = Number(tokenValue);
        if (isNaN(value)) {
          handleError(2);
          value = 0;
        }
        onLiteralValue(value);
        break;
      case 7:
        onLiteralValue(null);
        break;
      case 8:
        onLiteralValue(true);
        break;
      case 9:
        onLiteralValue(false);
        break;
      default:
        return false;
    }
    scanNext();
    return true;
  }
  function parseProperty() {
    if (_scanner.getToken() !== 10) {
      handleError(3, [], [2, 5]);
      return false;
    }
    parseString(false);
    if (_scanner.getToken() === 6) {
      onSeparator(":");
      scanNext();
      if (!parseValue()) {
        handleError(4, [], [2, 5]);
      }
    } else {
      handleError(5, [], [2, 5]);
    }
    _jsonPath.pop();
    return true;
  }
  function parseObject() {
    onObjectBegin();
    scanNext();
    let needsComma = false;
    while (_scanner.getToken() !== 2 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 2 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (!parseProperty()) {
        handleError(4, [], [2, 5]);
      }
      needsComma = true;
    }
    onObjectEnd();
    if (_scanner.getToken() !== 2) {
      handleError(7, [2], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseArray() {
    onArrayBegin();
    scanNext();
    let isFirstElement = true;
    let needsComma = false;
    while (_scanner.getToken() !== 4 && _scanner.getToken() !== 17) {
      if (_scanner.getToken() === 5) {
        if (!needsComma) {
          handleError(4, [], []);
        }
        onSeparator(",");
        scanNext();
        if (_scanner.getToken() === 4 && allowTrailingComma) {
          break;
        }
      } else if (needsComma) {
        handleError(6, [], []);
      }
      if (isFirstElement) {
        _jsonPath.push(0);
        isFirstElement = false;
      } else {
        _jsonPath[_jsonPath.length - 1]++;
      }
      if (!parseValue()) {
        handleError(4, [], [4, 5]);
      }
      needsComma = true;
    }
    onArrayEnd();
    if (!isFirstElement) {
      _jsonPath.pop();
    }
    if (_scanner.getToken() !== 4) {
      handleError(8, [4], []);
    } else {
      scanNext();
    }
    return true;
  }
  function parseValue() {
    switch (_scanner.getToken()) {
      case 3:
        return parseArray();
      case 1:
        return parseObject();
      case 10:
        return parseString(true);
      default:
        return parseLiteral();
    }
  }
  scanNext();
  if (_scanner.getToken() === 17) {
    if (options.allowEmptyContent) {
      return true;
    }
    handleError(4, [], []);
    return false;
  }
  if (!parseValue()) {
    handleError(4, [], []);
    return false;
  }
  if (_scanner.getToken() !== 17) {
    handleError(9, [], []);
  }
  return true;
}
function getNodeType(value) {
  switch (typeof value) {
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "string":
      return "string";
    case "object": {
      if (!value) {
        return "null";
      } else if (Array.isArray(value)) {
        return "array";
      }
      return "object";
    }
    default:
      return "null";
  }
}

// ../../../node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/edit.js
function setProperty(text, originalPath, value, options) {
  const path = originalPath.slice();
  const errors2 = [];
  const root = parseTree(text, errors2);
  let parent = undefined;
  let lastSegment = undefined;
  while (path.length > 0) {
    lastSegment = path.pop();
    parent = findNodeAtLocation(root, path);
    if (parent === undefined && value !== undefined) {
      if (typeof lastSegment === "string") {
        value = { [lastSegment]: value };
      } else {
        value = [value];
      }
    } else {
      break;
    }
  }
  if (!parent) {
    if (value === undefined) {
      throw new Error("Can not delete in empty document");
    }
    return withFormatting(text, { offset: root ? root.offset : 0, length: root ? root.length : 0, content: JSON.stringify(value) }, options);
  } else if (parent.type === "object" && typeof lastSegment === "string" && Array.isArray(parent.children)) {
    const existing = findNodeAtLocation(parent, [lastSegment]);
    if (existing !== undefined) {
      if (value === undefined) {
        if (!existing.parent) {
          throw new Error("Malformed AST");
        }
        const propertyIndex = parent.children.indexOf(existing.parent);
        let removeBegin;
        let removeEnd = existing.parent.offset + existing.parent.length;
        if (propertyIndex > 0) {
          let previous = parent.children[propertyIndex - 1];
          removeBegin = previous.offset + previous.length;
        } else {
          removeBegin = parent.offset + 1;
          if (parent.children.length > 1) {
            let next = parent.children[1];
            removeEnd = next.offset;
          }
        }
        return withFormatting(text, { offset: removeBegin, length: removeEnd - removeBegin, content: "" }, options);
      } else {
        return withFormatting(text, { offset: existing.offset, length: existing.length, content: JSON.stringify(value) }, options);
      }
    } else {
      if (value === undefined) {
        return [];
      }
      const newProperty = `${JSON.stringify(lastSegment)}: ${JSON.stringify(value)}`;
      const index = options.getInsertionIndex ? options.getInsertionIndex(parent.children.map((p) => p.children[0].value)) : parent.children.length;
      let edit;
      if (index > 0) {
        let previous = parent.children[index - 1];
        edit = { offset: previous.offset + previous.length, length: 0, content: "," + newProperty };
      } else if (parent.children.length === 0) {
        edit = { offset: parent.offset + 1, length: 0, content: newProperty };
      } else {
        edit = { offset: parent.offset + 1, length: 0, content: newProperty + "," };
      }
      return withFormatting(text, edit, options);
    }
  } else if (parent.type === "array" && typeof lastSegment === "number" && Array.isArray(parent.children)) {
    const insertIndex = lastSegment;
    if (insertIndex === -1) {
      const newProperty = `${JSON.stringify(value)}`;
      let edit;
      if (parent.children.length === 0) {
        edit = { offset: parent.offset + 1, length: 0, content: newProperty };
      } else {
        const previous = parent.children[parent.children.length - 1];
        edit = { offset: previous.offset + previous.length, length: 0, content: "," + newProperty };
      }
      return withFormatting(text, edit, options);
    } else if (value === undefined && parent.children.length >= 0) {
      const removalIndex = lastSegment;
      const toRemove = parent.children[removalIndex];
      let edit;
      if (parent.children.length === 1) {
        edit = { offset: parent.offset + 1, length: parent.length - 2, content: "" };
      } else if (parent.children.length - 1 === removalIndex) {
        let previous = parent.children[removalIndex - 1];
        let offset = previous.offset + previous.length;
        let parentEndOffset = parent.offset + parent.length;
        edit = { offset, length: parentEndOffset - 2 - offset, content: "" };
      } else {
        edit = { offset: toRemove.offset, length: parent.children[removalIndex + 1].offset - toRemove.offset, content: "" };
      }
      return withFormatting(text, edit, options);
    } else if (value !== undefined) {
      let edit;
      const newProperty = `${JSON.stringify(value)}`;
      if (!options.isArrayInsertion && parent.children.length > lastSegment) {
        const toModify = parent.children[lastSegment];
        edit = { offset: toModify.offset, length: toModify.length, content: newProperty };
      } else if (parent.children.length === 0 || lastSegment === 0) {
        edit = { offset: parent.offset + 1, length: 0, content: parent.children.length === 0 ? newProperty : newProperty + "," };
      } else {
        const index = lastSegment > parent.children.length ? parent.children.length : lastSegment;
        const previous = parent.children[index - 1];
        edit = { offset: previous.offset + previous.length, length: 0, content: "," + newProperty };
      }
      return withFormatting(text, edit, options);
    } else {
      throw new Error(`Can not ${value === undefined ? "remove" : options.isArrayInsertion ? "insert" : "modify"} Array index ${insertIndex} as length is not sufficient`);
    }
  } else {
    throw new Error(`Can not add ${typeof lastSegment !== "number" ? "index" : "property"} to parent of type ${parent.type}`);
  }
}
function withFormatting(text, edit, options) {
  if (!options.formattingOptions) {
    return [edit];
  }
  let newText = applyEdit(text, edit);
  let begin = edit.offset;
  let end = edit.offset + edit.content.length;
  if (edit.length === 0 || edit.content.length === 0) {
    while (begin > 0 && !isEOL(newText, begin - 1)) {
      begin--;
    }
    while (end < newText.length && !isEOL(newText, end)) {
      end++;
    }
  }
  const edits = format(newText, { offset: begin, length: end - begin }, { ...options.formattingOptions, keepLines: false });
  for (let i = edits.length - 1;i >= 0; i--) {
    const edit2 = edits[i];
    newText = applyEdit(newText, edit2);
    begin = Math.min(begin, edit2.offset);
    end = Math.max(end, edit2.offset + edit2.length);
    end += edit2.content.length - edit2.length;
  }
  const editLength = text.length - (newText.length - end) - begin;
  return [{ offset: begin, length: editLength, content: newText.substring(begin, end) }];
}
function applyEdit(text, edit) {
  return text.substring(0, edit.offset) + edit.content + text.substring(edit.offset + edit.length);
}

// ../../../node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/main.js
var ScanError;
(function(ScanError2) {
  ScanError2[ScanError2["None"] = 0] = "None";
  ScanError2[ScanError2["UnexpectedEndOfComment"] = 1] = "UnexpectedEndOfComment";
  ScanError2[ScanError2["UnexpectedEndOfString"] = 2] = "UnexpectedEndOfString";
  ScanError2[ScanError2["UnexpectedEndOfNumber"] = 3] = "UnexpectedEndOfNumber";
  ScanError2[ScanError2["InvalidUnicode"] = 4] = "InvalidUnicode";
  ScanError2[ScanError2["InvalidEscapeCharacter"] = 5] = "InvalidEscapeCharacter";
  ScanError2[ScanError2["InvalidCharacter"] = 6] = "InvalidCharacter";
})(ScanError || (ScanError = {}));
var SyntaxKind;
(function(SyntaxKind2) {
  SyntaxKind2[SyntaxKind2["OpenBraceToken"] = 1] = "OpenBraceToken";
  SyntaxKind2[SyntaxKind2["CloseBraceToken"] = 2] = "CloseBraceToken";
  SyntaxKind2[SyntaxKind2["OpenBracketToken"] = 3] = "OpenBracketToken";
  SyntaxKind2[SyntaxKind2["CloseBracketToken"] = 4] = "CloseBracketToken";
  SyntaxKind2[SyntaxKind2["CommaToken"] = 5] = "CommaToken";
  SyntaxKind2[SyntaxKind2["ColonToken"] = 6] = "ColonToken";
  SyntaxKind2[SyntaxKind2["NullKeyword"] = 7] = "NullKeyword";
  SyntaxKind2[SyntaxKind2["TrueKeyword"] = 8] = "TrueKeyword";
  SyntaxKind2[SyntaxKind2["FalseKeyword"] = 9] = "FalseKeyword";
  SyntaxKind2[SyntaxKind2["StringLiteral"] = 10] = "StringLiteral";
  SyntaxKind2[SyntaxKind2["NumericLiteral"] = 11] = "NumericLiteral";
  SyntaxKind2[SyntaxKind2["LineCommentTrivia"] = 12] = "LineCommentTrivia";
  SyntaxKind2[SyntaxKind2["BlockCommentTrivia"] = 13] = "BlockCommentTrivia";
  SyntaxKind2[SyntaxKind2["LineBreakTrivia"] = 14] = "LineBreakTrivia";
  SyntaxKind2[SyntaxKind2["Trivia"] = 15] = "Trivia";
  SyntaxKind2[SyntaxKind2["Unknown"] = 16] = "Unknown";
  SyntaxKind2[SyntaxKind2["EOF"] = 17] = "EOF";
})(SyntaxKind || (SyntaxKind = {}));
var parse5 = parse4;
var ParseErrorCode;
(function(ParseErrorCode2) {
  ParseErrorCode2[ParseErrorCode2["InvalidSymbol"] = 1] = "InvalidSymbol";
  ParseErrorCode2[ParseErrorCode2["InvalidNumberFormat"] = 2] = "InvalidNumberFormat";
  ParseErrorCode2[ParseErrorCode2["PropertyNameExpected"] = 3] = "PropertyNameExpected";
  ParseErrorCode2[ParseErrorCode2["ValueExpected"] = 4] = "ValueExpected";
  ParseErrorCode2[ParseErrorCode2["ColonExpected"] = 5] = "ColonExpected";
  ParseErrorCode2[ParseErrorCode2["CommaExpected"] = 6] = "CommaExpected";
  ParseErrorCode2[ParseErrorCode2["CloseBraceExpected"] = 7] = "CloseBraceExpected";
  ParseErrorCode2[ParseErrorCode2["CloseBracketExpected"] = 8] = "CloseBracketExpected";
  ParseErrorCode2[ParseErrorCode2["EndOfFileExpected"] = 9] = "EndOfFileExpected";
  ParseErrorCode2[ParseErrorCode2["InvalidCommentToken"] = 10] = "InvalidCommentToken";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfComment"] = 11] = "UnexpectedEndOfComment";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfString"] = 12] = "UnexpectedEndOfString";
  ParseErrorCode2[ParseErrorCode2["UnexpectedEndOfNumber"] = 13] = "UnexpectedEndOfNumber";
  ParseErrorCode2[ParseErrorCode2["InvalidUnicode"] = 14] = "InvalidUnicode";
  ParseErrorCode2[ParseErrorCode2["InvalidEscapeCharacter"] = 15] = "InvalidEscapeCharacter";
  ParseErrorCode2[ParseErrorCode2["InvalidCharacter"] = 16] = "InvalidCharacter";
})(ParseErrorCode || (ParseErrorCode = {}));
function printParseErrorCode(code) {
  switch (code) {
    case 1:
      return "InvalidSymbol";
    case 2:
      return "InvalidNumberFormat";
    case 3:
      return "PropertyNameExpected";
    case 4:
      return "ValueExpected";
    case 5:
      return "ColonExpected";
    case 6:
      return "CommaExpected";
    case 7:
      return "CloseBraceExpected";
    case 8:
      return "CloseBracketExpected";
    case 9:
      return "EndOfFileExpected";
    case 10:
      return "InvalidCommentToken";
    case 11:
      return "UnexpectedEndOfComment";
    case 12:
      return "UnexpectedEndOfString";
    case 13:
      return "UnexpectedEndOfNumber";
    case 14:
      return "InvalidUnicode";
    case 15:
      return "InvalidEscapeCharacter";
    case 16:
      return "InvalidCharacter";
  }
  return "<unknown ParseErrorCode>";
}
function modify(text, path, value, options) {
  return setProperty(text, path, value, options);
}
function applyEdits(text, edits) {
  let sortedEdits = edits.slice(0).sort((a, b) => {
    const diff = a.offset - b.offset;
    if (diff === 0) {
      return a.length - b.length;
    }
    return diff;
  });
  let lastModifiedOffset = text.length;
  for (let i = sortedEdits.length - 1;i >= 0; i--) {
    let e = sortedEdits[i];
    if (e.offset + e.length <= lastModifiedOffset) {
      text = applyEdit(text, e);
    } else {
      throw new Error("Overlapping edit");
    }
    lastModifiedOffset = e.offset;
  }
  return text;
}

// ../../omo-config-core/src/loader/merge.ts
var DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
function isUnsafeObjectKey(key) {
  return DANGEROUS_KEYS.has(key);
}
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
}
function sanitizeOmoConfigValue(value) {
  if (Array.isArray(value))
    return value.map((entry) => sanitizeOmoConfigValue(entry));
  if (!isPlainObject2(value))
    return value;
  const sanitized = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isUnsafeObjectKey(key))
      continue;
    sanitized[key] = sanitizeOmoConfigValue(entry);
  }
  return sanitized;
}
function mergeCodegraphExcludedRoots(base, override) {
  return [...new Set([...base, ...override])];
}
function mergeOmoConfigRecords(base, override, parentKey) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (isUnsafeObjectKey(key))
      continue;
    const safeValue = sanitizeOmoConfigValue(value);
    const baseValue = result[key];
    result[key] = key === "excluded_roots" && parentKey === "codegraph" && Array.isArray(baseValue) && Array.isArray(safeValue) ? mergeCodegraphExcludedRoots(baseValue, safeValue) : isPlainObject2(baseValue) && isPlainObject2(safeValue) ? mergeOmoConfigRecords(baseValue, safeValue, key) : safeValue;
  }
  return result;
}

// ../../omo-config-core/src/loader/paths.ts
import { userInfo } from "node:os";
import { dirname as dirname2, join as join6, posix, resolve as resolve4 } from "node:path";

// ../../omo-config-core/src/internal/posix-path.ts
function toPosixPath(path) {
  return path.split("\\").join("/");
}

// ../../omo-config-core/src/loader/types.ts
import { existsSync as existsSync3, lstatSync as lstatSync3, readFileSync as readFileSync3, realpathSync as realpathSync4 } from "node:fs";
var DEFAULT_READ_FILE_SYSTEM = {
  existsSync: existsSync3,
  lstatSync: lstatSync3,
  readFileSync: readFileSync3,
  realpathSync: realpathSync4
};

// ../../omo-config-core/src/loader/paths.ts
var MAX_PROJECT_CONFIG_DIRECTORY_DEPTH = 256;
var ACCOUNT_HOME_DIR = userInfo().homedir;
function resolveHomeDir(env = process.env) {
  const homeDir = env.HOME ?? env.USERPROFILE ?? process.cwd();
  return homeDir.startsWith("/") ? posix.resolve(homeDir) : toPosixPath(resolve4(homeDir));
}
function resolveUserOmoConfigPath(env = process.env) {
  return join6(resolveUserOmoConfigDirectory(env), "omo.jsonc");
}
function resolveUserOmoConfigDirectory(env = process.env) {
  return join6(resolveHomeDir(env), ".omo");
}
function detectUserOmoJsonPath(env, fileSystem) {
  const configDir = resolveUserOmoConfigDirectory(env);
  const jsoncPath = join6(configDir, "omo.jsonc");
  if (fileSystem.existsSync(jsoncPath))
    return jsoncPath;
  const jsonPath = join6(configDir, "omo.json");
  return fileSystem.existsSync(jsonPath) ? jsonPath : jsoncPath;
}
function isSymlinkedProjectPath(path, fileSystem) {
  if (fileSystem.lstatSync === undefined || !fileSystem.existsSync(path))
    return false;
  try {
    return fileSystem.lstatSync(path).isSymbolicLink();
  } catch (error) {
    if (error instanceof Error)
      return true;
    throw error;
  }
}
function isLoadableProjectConfigFile(path, fileSystem) {
  return fileSystem.existsSync(path) && !isSymlinkedProjectPath(path, fileSystem);
}
function detectOmoJsonPath(dir, fileSystem) {
  const omoDir = join6(dir, ".omo");
  if (isSymlinkedProjectPath(omoDir, fileSystem))
    return null;
  const jsoncPath = join6(omoDir, "omo.jsonc");
  if (isLoadableProjectConfigFile(jsoncPath, fileSystem))
    return jsoncPath;
  const jsonPath = join6(omoDir, "omo.json");
  return isLoadableProjectConfigFile(jsonPath, fileSystem) ? jsonPath : null;
}
function realpathOrSelf(path, fileSystem) {
  if (fileSystem.realpathSync === undefined)
    return path;
  try {
    return fileSystem.realpathSync(path);
  } catch {
    return path;
  }
}
function findProjectConfigPathsFarthestFirst(cwd, homeDir, fileSystem, accountHomeDir = homeDir) {
  const startDir = resolve4(cwd);
  const boundaryDirs = [...new Set([resolve4(homeDir), resolve4(accountHomeDir)])];
  const realBoundaryDirs = new Set(boundaryDirs.map((path) => realpathOrSelf(path, fileSystem)));
  const nearestFirst = [];
  let currentDir = startDir;
  for (let depth = 0;depth < MAX_PROJECT_CONFIG_DIRECTORY_DEPTH; depth += 1) {
    const isHomeDir = boundaryDirs.includes(currentDir) || realBoundaryDirs.has(realpathOrSelf(currentDir, fileSystem));
    const configPath = isHomeDir ? null : detectOmoJsonPath(currentDir, fileSystem);
    if (configPath !== null)
      nearestFirst.push(configPath);
    if (isHomeDir)
      break;
    const parentDir = dirname2(currentDir);
    if (parentDir === currentDir)
      break;
    currentDir = parentDir;
  }
  return nearestFirst.reverse();
}
function resolveOmoConfigPaths(options) {
  const fileSystem = options.fileSystem ?? DEFAULT_READ_FILE_SYSTEM;
  const env = options.env ?? process.env;
  const userPath = detectUserOmoJsonPath(env, fileSystem);
  const projectPaths = findProjectConfigPathsFarthestFirst(options.cwd, resolveHomeDir(env), fileSystem, ACCOUNT_HOME_DIR);
  return [
    { path: userPath, scope: "user" },
    ...projectPaths.map((path) => ({ path, scope: "project" }))
  ];
}

// ../../omo-config-core/src/loader/resolution.ts
var HARNESS_KEYS = [...new Set([...HARNESS_IDS, ...OMO_CONFIG_HARNESS_IDS])].map((harness) => `[${harness}]`);
function profileName(value) {
  return value === "" ? undefined : value;
}
function profileNameFromOpenCodeConfigDir(path) {
  const match = path?.match(/(?:^|[\\/])profiles[\\/]([^\\/]+)[\\/]*$/);
  return profileName(match?.[1]);
}
function resolveOmoProfileName(options = {}) {
  const env = options.env ?? process.env;
  return profileName(options.profile) ?? profileName(env["OMO_PROFILE"]) ?? profileName(env["OCX_PROFILE"]) ?? profileNameFromOpenCodeConfigDir(env["OPENCODE_CONFIG_DIR"]);
}
function toRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return;
  return Object.fromEntries(Object.entries(value));
}
function withoutControlKeys(config2) {
  const result = {};
  for (const [key, value] of Object.entries(config2)) {
    if (key === "profiles" || HARNESS_KEYS.includes(key))
      continue;
    result[key] = value;
  }
  return result;
}
function harnessLayer(config2, harness) {
  if (harness === undefined)
    return {};
  return toRecord(config2[`[${harness}]`]) ?? {};
}
function resolveOmoConfigView(options) {
  const profiles = toRecord(options.config["profiles"]);
  const profile = options.profile === undefined ? undefined : toRecord(profiles?.[options.profile]);
  const diagnostics = profile === undefined && options.profile !== undefined ? [{
    kind: "profile",
    message: `Activated omo profile "${options.profile}" does not exist; using the base configuration`,
    path: `profiles.${options.profile}`
  }] : [];
  const layers = [
    withoutControlKeys(options.config),
    harnessLayer(options.config, options.harness),
    profile === undefined ? {} : withoutControlKeys(profile),
    profile === undefined ? {} : harnessLayer(profile, options.harness)
  ];
  let config2 = {};
  for (const layer of layers)
    config2 = mergeOmoConfigRecords(config2, layer);
  const resolvedProfile = options.profile !== undefined && profile !== undefined ? options.profile : undefined;
  return {
    config: withoutControlKeys(config2),
    diagnostics,
    ...resolvedProfile === undefined ? {} : { profile: resolvedProfile }
  };
}

// ../../omo-config-core/src/loader/loader.ts
function parseJsoncSafe(content) {
  const errors2 = [];
  const data = parse5(content.charCodeAt(0) === 65279 ? content.slice(1) : content, errors2, {
    allowTrailingComma: true,
    disallowComments: false
  });
  return {
    data: errors2.length === 0 ? data : null,
    errors: errors2.map((error) => ({
      message: printParseErrorCode(error.error),
      offset: error.offset
    }))
  };
}
var DEFAULT_RAW_CONFIG = {
  agents: {},
  categories: {},
  codegraph: OmoCodegraphSettingsSchema.parse({}),
  task: resolveOmoTaskSettings({}),
  teams: {}
};
function stripResolutionControlKeys(config2) {
  const {
    "[codex]": _codex,
    "[opencode]": _opencode,
    "[senpi]": _senpi,
    profiles: _profiles,
    ...resolved
  } = config2;
  return resolved;
}
function validationDiagnostic(path, issues) {
  const issuePaths = issues.map((issue2) => issue2.path.map((segment) => String(segment)).join("."));
  return {
    kind: "validation",
    message: `Invalid omo config at ${path}: ${issuePaths.join(", ")}`,
    path,
    issuePaths
  };
}
function toRecord2(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const record2 = {};
  for (const [key, entry] of Object.entries(value)) {
    record2[key] = entry;
  }
  return record2;
}
function readConfigSource(path, scope, fileSystem) {
  if (!fileSystem.existsSync(path)) {
    return { source: { exists: false, loaded: false, path, scope } };
  }
  let content;
  try {
    content = fileSystem.readFileSync(path, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      diagnostic: { kind: "read", message: `Failed to read ${path}: ${message}`, path },
      source: { exists: true, loaded: false, path, scope }
    };
  }
  const parsed = parseJsoncSafe(content);
  if (parsed.errors.length > 0) {
    return {
      diagnostic: {
        kind: "parse",
        message: `JSONC parse error in ${path}: ${parsed.errors.map((error) => error.message).join(", ")}`,
        path
      },
      source: { exists: true, loaded: false, path, scope }
    };
  }
  const validation = OmoConfigLayerSchema.safeParse(parsed.data);
  if (!validation.success) {
    return {
      diagnostic: validationDiagnostic(path, validation.error.issues),
      source: { exists: true, loaded: false, path, scope }
    };
  }
  const parsedRecord = toRecord2(parsed.data);
  if (parsedRecord === null) {
    return {
      diagnostic: { kind: "validation", message: `Invalid omo config at ${path}: root must be an object`, path },
      source: { exists: true, loaded: false, path, scope }
    };
  }
  return {
    source: { exists: true, loaded: true, path, scope },
    value: parsedRecord
  };
}
function loadOmoConfig(options = {}) {
  const fileSystem = options.fileSystem ?? DEFAULT_READ_FILE_SYSTEM;
  const cwd = options.cwd ?? process.cwd();
  let merged = {};
  const diagnostics = [];
  const layers = [];
  const sources = [];
  for (const candidate of resolveOmoConfigPaths({
    cwd,
    ...options.env === undefined ? {} : { env: options.env },
    fileSystem,
    ...options.platform === undefined ? {} : { platform: options.platform }
  })) {
    const loaded = readConfigSource(candidate.path, candidate.scope, fileSystem);
    sources.push(loaded.source);
    if (loaded.diagnostic !== undefined)
      diagnostics.push(loaded.diagnostic);
    if (loaded.value !== undefined) {
      layers.push({ config: loaded.value, source: loaded.source });
      merged = mergeOmoConfigRecords(merged, loaded.value);
    }
  }
  const requestedProfile = resolveOmoProfileName({
    ...options.env === undefined ? {} : { env: options.env },
    ...options.profile === undefined ? {} : { profile: options.profile }
  });
  const resolved = resolveOmoConfigView({
    config: merged,
    ...options.harness === undefined ? {} : { harness: options.harness },
    ...requestedProfile === undefined ? {} : { profile: requestedProfile }
  });
  const finalConfig = OmoConfigSchema.safeParse(mergeOmoConfigRecords(DEFAULT_RAW_CONFIG, resolved.config));
  if (finalConfig.success) {
    return {
      config: stripResolutionControlKeys(finalConfig.data),
      diagnostics: [...diagnostics, ...resolved.diagnostics],
      layers,
      ...resolved.profile === undefined ? {} : { profile: resolved.profile },
      sources
    };
  }
  return {
    config: stripResolutionControlKeys(OmoConfigSchema.parse(DEFAULT_RAW_CONFIG)),
    diagnostics: [...diagnostics, ...resolved.diagnostics, validationDiagnostic("(merged omo config)", finalConfig.error.issues)],
    layers,
    ...resolved.profile === undefined ? {} : { profile: resolved.profile },
    sources
  };
}

// ../../omo-config-core/src/writer/types.ts
import {
  copyFileSync,
  existsSync as existsSync4,
  lstatSync as lstatSync4,
  mkdirSync as mkdirSync2,
  readFileSync as readFileSync4,
  readdirSync as readdirSync2,
  renameSync,
  unlinkSync,
  writeFileSync as writeFileSync2
} from "node:fs";
var DEFAULT_WRITE_FILE_SYSTEM = {
  copyFileSync,
  existsSync: existsSync4,
  lstatSync: lstatSync4,
  mkdirSync: mkdirSync2,
  readFileSync: readFileSync4,
  readdirSync: readdirSync2,
  renameSync,
  unlinkSync,
  writeFileExclusiveSync: (path, content) => {
    writeFileSync2(path, content, { encoding: "utf-8", flag: "wx" });
  },
  writeFileSync: writeFileSync2
};

class OmoConfigWriteError extends Error {
  path;
  operation;
  name = "OmoConfigWriteError";
  constructor(path, operation, cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to ${operation} omo config at ${path}: ${detail}`, { cause });
    this.path = path;
    this.operation = operation;
  }
}

// ../../omo-config-core/src/writer/writer.ts
import { randomUUID } from "node:crypto";
import { dirname as dirname3, join as join7, posix as posix2 } from "node:path";

// ../../omo-config-core/src/internal/jsonc-parse.ts
function stripBom(content) {
  return content.charCodeAt(0) === 65279 ? content.slice(1) : content;
}
function parseJsoncSafe2(content) {
  const errors2 = [];
  const data = parse5(stripBom(content), errors2, {
    allowTrailingComma: true,
    disallowComments: false
  });
  return {
    data: errors2.length > 0 ? null : data,
    errors: errors2.map((e) => ({
      message: printParseErrorCode(e.error),
      offset: e.offset,
      length: e.length
    }))
  };
}

// ../../omo-config-core/src/writer/writer.ts
var EMPTY_OMO_CONFIG = `// OMO configuration
{
}
`;
var FORMATTING_OPTIONS = {
  eol: `
`,
  insertSpaces: true,
  tabSize: 2
};
function backupSuffix() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
function isFileExistsError(error) {
  return error instanceof Error && Reflect.get(error, "code") === "EEXIST";
}
function backupCandidate(basePath, attempt) {
  return attempt === 0 ? basePath : `${basePath}.${attempt}`;
}
function writeBackup(path, content, fileSystem) {
  const basePath = `${path}.bak.${backupSuffix()}`;
  let attempt = 0;
  while (true) {
    const candidate = backupCandidate(basePath, attempt);
    try {
      fileSystem.writeFileExclusiveSync(candidate, content);
      return candidate;
    } catch (error) {
      if (!isFileExistsError(error))
        throw error;
      attempt += 1;
    }
  }
}
function resolveWritePath(options) {
  if (options.targetPath !== undefined)
    return options.targetPath;
  const fileSystem = options.fileSystem ?? DEFAULT_WRITE_FILE_SYSTEM;
  if (options.scope === "user") {
    const jsoncPath2 = resolveUserOmoConfigPath(options.env);
    if (fileSystem.existsSync(jsoncPath2))
      return jsoncPath2;
    const jsonPath2 = join7(dirname3(jsoncPath2), "omo.json");
    return fileSystem.existsSync(jsonPath2) ? jsonPath2 : jsoncPath2;
  }
  const jsoncPath = join7(options.projectDir ?? process.cwd(), ".omo", "omo.jsonc");
  if (fileSystem.existsSync(jsoncPath))
    return jsoncPath;
  const jsonPath = join7(dirname3(jsoncPath), "omo.json");
  return fileSystem.existsSync(jsonPath) ? jsonPath : jsoncPath;
}
function directoryPath(path) {
  return path.startsWith("/") ? posix2.dirname(path) : dirname3(path);
}
function writeAtomically(path, content, fileSystem) {
  const tempPath = `${path}.${randomUUID()}.tmp`;
  let tempCreated = false;
  try {
    fileSystem.writeFileExclusiveSync(tempPath, content);
    tempCreated = true;
    fileSystem.renameSync(tempPath, path);
  } catch (error) {
    try {
      if (tempCreated)
        fileSystem.unlinkSync(tempPath);
    } catch (cleanupError) {
      if (!(cleanupError instanceof Error))
        throw cleanupError;
    }
    throw new OmoConfigWriteError(path, "write", error);
  }
}
function assertConfigPathIsSafe(path, fileSystem) {
  try {
    if (fileSystem.lstatSync(path).isSymbolicLink()) {
      throw new OmoConfigWriteError(path, "read", new Error("Refusing to edit symlinked omo config"));
    }
  } catch (error) {
    if (error instanceof OmoConfigWriteError)
      throw error;
    throw new OmoConfigWriteError(path, "read", error);
  }
}
function assertProjectConfigDirectoryIsSafe(directory, fileSystem) {
  try {
    if (fileSystem.lstatSync(directory).isSymbolicLink()) {
      throw new OmoConfigWriteError(directory, "read", new Error("Refusing to edit config under symlinked project .omo directory"));
    }
  } catch (error) {
    if (error instanceof OmoConfigWriteError)
      throw error;
    throw new OmoConfigWriteError(directory, "read", error);
  }
}
function assertJsoncCanBeModified(path, content) {
  const parsed = parseJsoncSafe2(content);
  if (parsed.errors.length === 0)
    return;
  const message = parsed.errors.map((error) => `${error.message} at offset ${error.offset}`).join(", ");
  throw new OmoConfigWriteError(path, "parse", new SyntaxError(message));
}
function updateOmoConfig(options) {
  const fileSystem = options.fileSystem ?? DEFAULT_WRITE_FILE_SYSTEM;
  const path = resolveWritePath(options);
  const directory = directoryPath(path);
  const existed = fileSystem.existsSync(path);
  let content = EMPTY_OMO_CONFIG;
  try {
    fileSystem.mkdirSync(directory, { recursive: true });
    if (options.scope === "project")
      assertProjectConfigDirectoryIsSafe(directory, fileSystem);
    if (existed) {
      assertConfigPathIsSafe(path, fileSystem);
      content = fileSystem.readFileSync(path, "utf-8");
    }
  } catch (error) {
    if (error instanceof OmoConfigWriteError)
      throw error;
    throw new OmoConfigWriteError(path, "read", error);
  }
  assertJsoncCanBeModified(path, content);
  let backupPath;
  if (existed) {
    try {
      assertConfigPathIsSafe(path, fileSystem);
      backupPath = writeBackup(path, content, fileSystem);
    } catch (error) {
      if (error instanceof OmoConfigWriteError)
        throw error;
      throw new OmoConfigWriteError(path, "backup", error);
    }
  }
  let nextContent = content;
  for (const edit of options.edits) {
    nextContent = applyEdits(nextContent, modify(nextContent, [...edit.path], edit.value, { formattingOptions: FORMATTING_OPTIONS }));
  }
  writeAtomically(path, nextContent, fileSystem);
  return backupPath === undefined ? { path } : { backupPath, path };
}

// ../../omo-config-core/src/migration/batch.ts
import { dirname as dirname5, posix as posix3 } from "node:path";

// ../../omo-config-core/src/internal/plain-object.ts
var DANGEROUS_KEYS2 = new Set(["__proto__", "constructor", "prototype"]);
function isUnsafeObjectKey2(key) {
  return DANGEROUS_KEYS2.has(key);
}
function isPlainObject3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
}

// ../../omo-config-core/src/migration/backup-move.ts
function isCrossDeviceError(error) {
  return error instanceof Error && Reflect.get(error, "code") === "EXDEV";
}
function moveMigrationBackup(fileSystem, sourcePath, backupPath) {
  try {
    fileSystem.renameSync(sourcePath, backupPath);
  } catch (error) {
    if (!isCrossDeviceError(error))
      throw error;
    fileSystem.copyFileSync(sourcePath, backupPath);
    fileSystem.unlinkSync(sourcePath);
  }
}

// ../../omo-config-core/src/migration/commit.ts
import { basename as basename2, dirname as dirname4, join as join8, resolve as resolve5 } from "node:path";

// ../../omo-config-core/src/migration/merge.ts
function displayValue(value) {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}
function displayPath(path) {
  return path.join(".");
}
function cloneValue(value) {
  if (Array.isArray(value))
    return value.map((entry) => cloneValue(entry));
  if (!isPlainObject3(value))
    return value;
  const clone2 = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isUnsafeObjectKey2(key))
      continue;
    clone2[key] = cloneValue(entry);
  }
  return clone2;
}
function hasOwn(record2, key) {
  return Object.prototype.hasOwnProperty.call(record2, key);
}
function mergeInto(existing, legacy, path, diagnostics) {
  const additions = {};
  for (const [key, legacyValue] of Object.entries(legacy)) {
    if (isUnsafeObjectKey2(key))
      continue;
    const nextPath = [...path, key];
    if (!hasOwn(existing, key)) {
      additions[key] = cloneValue(legacyValue);
      continue;
    }
    const keptValue = existing[key];
    if (isPlainObject3(keptValue) && isPlainObject3(legacyValue)) {
      const nested = mergeInto(keptValue, legacyValue, nextPath, diagnostics);
      if (Object.keys(nested).length > 0)
        additions[key] = nested;
      continue;
    }
    diagnostics.push(`skipped: ${displayPath(nextPath)} legacy=${displayValue(legacyValue)} kept=${displayValue(keptValue)}`);
  }
  return additions;
}
function applyAdditions(existing, additions) {
  const result = cloneValue(existing);
  if (!isPlainObject3(result))
    throw new Error("Migration target must be a plain object");
  for (const [key, value] of Object.entries(additions)) {
    if (isUnsafeObjectKey2(key))
      continue;
    const current = result[key];
    result[key] = isPlainObject3(current) && isPlainObject3(value) ? applyAdditions(current, value) : cloneValue(value);
  }
  return result;
}
function mergeWithoutClobber(existing, legacy) {
  const diagnostics = [];
  const additions = mergeInto(existing, legacy, [], diagnostics);
  return {
    additions,
    diagnostics,
    merged: applyAdditions(existing, additions)
  };
}
function collectMigrationEdits(value, path = []) {
  const edits = [];
  for (const [key, entry] of Object.entries(value)) {
    if (isUnsafeObjectKey2(key))
      continue;
    const nextPath = [...path, key];
    if (isPlainObject3(entry) && Object.keys(entry).length > 0) {
      edits.push(...collectMigrationEdits(entry, nextPath));
    } else {
      edits.push({ path: nextPath, value: cloneValue(entry) });
    }
  }
  return edits;
}

// ../../omo-config-core/src/migration/predicate.ts
function hasMigrationMarker(target, migrationId) {
  const markers = target["_migrations"];
  return Array.isArray(markers) && markers.some((marker) => marker === migrationId);
}
function shouldRunMigration(input) {
  return input.legacySourcesExist && !hasMigrationMarker(input.target, input.migrationId);
}

// ../../omo-config-core/src/migration/types.ts
class MigrationValidationError extends Error {
  targetPath;
  name = "MigrationValidationError";
  constructor(targetPath, message) {
    super(`Migration validation failed for ${targetPath}: ${message}`);
    this.targetPath = targetPath;
  }
}

class MigrationTransactionError extends Error {
  name = "MigrationTransactionError";
  constructor(message) {
    super(message);
  }
}
var DEFAULT_MIGRATION_CLOCK = {
  now: () => Date.now()
};
var DEFAULT_MIGRATION_PROCESS = {
  isAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (!(error instanceof Error))
        throw error;
      return Reflect.get(error, "code") !== "ESRCH";
    }
  },
  pid: process.pid
};
var DEFAULT_MIGRATION_FILE_SYSTEM = {
  ...DEFAULT_WRITE_FILE_SYSTEM,
  removeIfContentsMatchSync: (path, expected) => {
    if (!DEFAULT_WRITE_FILE_SYSTEM.existsSync(path))
      return false;
    if (DEFAULT_WRITE_FILE_SYSTEM.readFileSync(path, "utf-8") !== expected)
      return false;
    DEFAULT_WRITE_FILE_SYSTEM.unlinkSync(path);
    return true;
  },
  replaceIfContentsMatchSync: (path, expected, content) => {
    if (!DEFAULT_WRITE_FILE_SYSTEM.existsSync(path))
      return false;
    if (DEFAULT_WRITE_FILE_SYSTEM.readFileSync(path, "utf-8") !== expected)
      return false;
    DEFAULT_WRITE_FILE_SYSTEM.writeFileSync(path, content, "utf-8");
    return true;
  }
};

// ../../omo-config-core/src/migration/commit.ts
function parseDocument(path, content) {
  const parsed = parseJsoncSafe2(content);
  if (parsed.errors.length > 0 || !isPlainObject3(parsed.data)) {
    const detail = parsed.errors.map((error) => `${error.message} at ${error.offset}`).join(", ");
    throw new MigrationTransactionError(`Migration document at ${path} is not a JSONC object${detail === "" ? "" : `: ${detail}`}`);
  }
  return parsed.data;
}
function targetDocument(path, fileSystem) {
  if (!fileSystem.existsSync(path))
    return {};
  return parseDocument(path, fileSystem.readFileSync(path, "utf-8"));
}
function markerValue(target, migrationId, targetPath) {
  const value = target["_migrations"];
  if (value === undefined)
    return [migrationId];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new MigrationValidationError(targetPath, "the existing migration marker must be an array of strings");
  }
  return hasMigrationMarker(target, migrationId) ? value : [...value, migrationId];
}
function validateTarget(targetPath, document) {
  const result = OmoConfigSchema.safeParse(document);
  if (result.success)
    return;
  const detail = result.error.issues.map((issue2) => `${issue2.path.join(".")}: ${issue2.message}`).join(", ");
  throw new MigrationValidationError(targetPath, detail);
}
function writerInput(targetPath, env) {
  const homeDir = resolveHomeDir(env);
  const userDirectory = toPosixPath(join8(homeDir, ".omo"));
  const fileName = basename2(targetPath);
  if (toPosixPath(dirname4(targetPath)) === userDirectory && (fileName === "omo.json" || fileName === "omo.jsonc")) {
    return { scope: "user" };
  }
  if (basename2(dirname4(targetPath)) === ".omo" && (fileName === "omo.json" || fileName === "omo.jsonc")) {
    return { projectDir: dirname4(dirname4(targetPath)), scope: "project" };
  }
  throw new MigrationTransactionError(`Migration target is not an omo config path: ${targetPath}`);
}
function sameResolvedPath(a, b) {
  return toPosixPath(resolve5(a)) === toPosixPath(resolve5(b));
}
var writeOmoMigrationTarget = (input) => {
  const options = writerInput(input.targetPath, input.env);
  const result = updateOmoConfig({
    ...options,
    edits: input.edits,
    env: input.env,
    fileSystem: input.fileSystem,
    targetPath: input.targetPath
  });
  if (!sameResolvedPath(result.path, input.targetPath)) {
    throw new MigrationTransactionError(`Migration writer resolved ${result.path} instead of ${input.targetPath}`);
  }
};
function prepareTargetWrite(input) {
  const merged = mergeWithoutClobber(input.target, input.additions);
  const marker = markerValue(input.target, input.migrationId, input.targetPath);
  const document = { ...merged.merged, _migrations: marker };
  validateTarget(input.targetPath, document);
  const edits = [...collectMigrationEdits(merged.additions), { path: ["_migrations"], value: marker }];
  return { diagnostics: merged.diagnostics, document, edits };
}
function prepareTargetReplacement(input) {
  const marker = markerValue(input.target, input.migrationId, input.targetPath);
  const document = { ...input.document, _migrations: marker };
  validateTarget(input.targetPath, document);
  const edits = [];
  for (const key of Object.keys(input.target)) {
    if (key !== "_migrations" && !Object.prototype.hasOwnProperty.call(input.document, key)) {
      edits.push({ path: [key], value: undefined });
    }
  }
  for (const [key, value] of Object.entries(input.document)) {
    if (key !== "_migrations")
      edits.push({ path: [key], value });
  }
  edits.push({ path: ["_migrations"], value: marker });
  return { diagnostics: [], document, edits };
}
function writePreparedTarget(input) {
  input.writeTarget({
    edits: input.prepared.edits,
    env: input.env,
    fileSystem: input.fileSystem,
    targetPath: input.targetPath
  });
}

// ../../omo-config-core/src/migration/journal.ts
import { join as join9 } from "node:path";
function migrationJournalPath(env) {
  return toPosixPath(join9(resolveHomeDir(env), ".omo", ".migration-journal.json"));
}
function isFileExistsError2(error) {
  return error instanceof Error && Reflect.get(error, "code") === "EEXIST";
}
function journalTempPath(path, process3, clock, attempt) {
  const suffix = `${process3.pid}.${clock.now()}`;
  return attempt === 0 ? `${path}.${suffix}.tmp` : `${path}.${suffix}.${attempt}.tmp`;
}
function parseJournal(value) {
  if (!isPlainObject3(value))
    throw new Error("Migration journal must be an object");
  if (value["version"] !== 1)
    throw new Error("Migration journal version is unsupported");
  if (typeof value["targetPath"] !== "string" || typeof value["migrationId"] !== "string") {
    throw new Error("Migration journal target is invalid");
  }
  if (!isPlainObject3(value["targetWrite"]) || !isPlainObject3(value["targetWrite"]["additions"])) {
    throw new Error("Migration journal target write is invalid");
  }
  const targetWriteMode = value["targetWrite"]["mode"];
  if (targetWriteMode !== undefined && targetWriteMode !== "replace-target") {
    throw new Error("Migration journal target write mode is invalid");
  }
  if (typeof value["targetWritten"] !== "boolean" || !Array.isArray(value["completedMoves"])) {
    throw new Error("Migration journal completion state is invalid");
  }
  const diagnostics = value["diagnostics"];
  if (diagnostics !== undefined && (!Array.isArray(diagnostics) || !diagnostics.every((entry) => typeof entry === "string"))) {
    throw new Error("Migration journal diagnostics are invalid");
  }
  if (!value["completedMoves"].every((path) => typeof path === "string")) {
    throw new Error("Migration journal completed moves are invalid");
  }
  if (!Array.isArray(value["backupMoves"]))
    throw new Error("Migration journal backup plan is invalid");
  const backupMoves = [];
  for (const move of value["backupMoves"]) {
    if (!isPlainObject3(move) || typeof move["from"] !== "string" || typeof move["to"] !== "string") {
      throw new Error("Migration journal backup move is invalid");
    }
    backupMoves.push({ from: move["from"], to: move["to"] });
  }
  return {
    backupMoves,
    completedMoves: [...value["completedMoves"]],
    diagnostics: diagnostics === undefined ? [] : [...diagnostics],
    migrationId: value["migrationId"],
    targetPath: value["targetPath"],
    targetWrite: {
      additions: { ...value["targetWrite"]["additions"] },
      ...targetWriteMode === undefined ? {} : { mode: targetWriteMode }
    },
    targetWritten: value["targetWritten"],
    version: 1
  };
}
function readMigrationJournal(fileSystem, env) {
  const path = migrationJournalPath(env);
  if (!fileSystem.existsSync(path))
    return null;
  return parseJournal(JSON.parse(fileSystem.readFileSync(path, "utf-8")));
}
function writeMigrationJournal(journal, fileSystem, env, process3, clock) {
  const path = migrationJournalPath(env);
  const content = `${JSON.stringify(journal)}
`;
  let attempt = 0;
  while (true) {
    const temporaryPath = journalTempPath(path, process3, clock, attempt);
    try {
      fileSystem.writeFileExclusiveSync(temporaryPath, content);
      fileSystem.renameSync(temporaryPath, path);
      return;
    } catch (error) {
      if (!isFileExistsError2(error))
        throw error;
      attempt += 1;
    }
  }
}
function removeMigrationJournal(fileSystem, env) {
  const path = migrationJournalPath(env);
  if (fileSystem.existsSync(path))
    fileSystem.unlinkSync(path);
}

// ../../omo-config-core/src/migration/lock.ts
import { join as join10 } from "node:path";
var DEFAULT_LEASE_DURATION_MS = 30000;
var GUARD_LEASE_DURATION_MS = 1000;
var LIVE_OWNER_STALE_LEASE_MULTIPLIER = 2;
var MUTATION_GUARD_RETRY_DELAYS_MS = [2, 4, 8, 16, 32];
var MUTATION_GUARD_SLEEP_VIEW = new Int32Array(new SharedArrayBuffer(4));
function migrationLockPath(env) {
  return toPosixPath(join10(resolveHomeDir(env), ".omo", ".migration.lock"));
}
function mutationGuardPath(env) {
  return `${migrationLockPath(env)}.guard`;
}
function isFileExistsError3(error) {
  return error instanceof Error && Reflect.get(error, "code") === "EEXIST";
}
function isFileMissingError(error) {
  return error instanceof Error && Reflect.get(error, "code") === "ENOENT";
}
function parseLockRecord(content) {
  try {
    const value = JSON.parse(content);
    if (typeof value !== "object" || value === null)
      return null;
    const pid = Reflect.get(value, "pid");
    const leaseExpiresAt = Reflect.get(value, "leaseExpiresAt");
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid < 1)
      return null;
    if (typeof leaseExpiresAt !== "number" || !Number.isFinite(leaseExpiresAt))
      return null;
    return { leaseExpiresAt, pid };
  } catch (error) {
    if (error instanceof SyntaxError)
      return null;
    throw error;
  }
}
function leaseContent(process3, clock, duration3) {
  return `${JSON.stringify({ leaseExpiresAt: clock.now() + duration3, pid: process3.pid })}
`;
}
function isReclaimable(record2, clock, process3, leaseDurationMs) {
  const now = clock.now();
  if (record2.leaseExpiresAt > now)
    return false;
  if (!process3.isAlive(record2.pid))
    return true;
  return record2.leaseExpiresAt + leaseDurationMs * LIVE_OWNER_STALE_LEASE_MULTIPLIER <= now;
}
function sleepSync(milliseconds) {
  Atomics.wait(MUTATION_GUARD_SLEEP_VIEW, 0, 0, milliseconds);
}
function acquireMutationGuard(input) {
  const path = mutationGuardPath(input.env);
  for (let attempt = 0;attempt <= MUTATION_GUARD_RETRY_DELAYS_MS.length; attempt += 1) {
    const content = leaseContent(input.process, input.clock, GUARD_LEASE_DURATION_MS);
    try {
      input.fileSystem.writeFileExclusiveSync(path, content);
      return content;
    } catch (error) {
      if (!isFileExistsError3(error))
        throw error;
    }
    try {
      const observedContent = input.fileSystem.readFileSync(path, "utf-8");
      const observed = parseLockRecord(observedContent);
      if (observed === null || isReclaimable(observed, input.clock, input.process, GUARD_LEASE_DURATION_MS)) {
        input.fileSystem.removeIfContentsMatchSync(path, observedContent);
      }
    } catch (error) {
      if (!isFileMissingError(error))
        throw error;
    }
    const retryDelayMs = MUTATION_GUARD_RETRY_DELAYS_MS[attempt];
    if (retryDelayMs !== undefined)
      sleepSync(retryDelayMs);
  }
  return null;
}
function releaseMutationGuard(input) {
  input.fileSystem.removeIfContentsMatchSync(mutationGuardPath(input.env), input.content);
}
function acquireMigrationLock(input) {
  const leaseDurationMs = input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const path = migrationLockPath(input.env);
  input.fileSystem.mkdirSync(toPosixPath(join10(resolveHomeDir(input.env), ".omo")), { recursive: true });
  for (let attempt = 0;attempt < 3; attempt += 1) {
    const currentContent = leaseContent(input.process, input.clock, leaseDurationMs);
    try {
      input.fileSystem.writeFileExclusiveSync(path, currentContent);
      let ownedContent = currentContent;
      const mutate = (mutation) => {
        const guardContent2 = acquireMutationGuard(input);
        if (guardContent2 === null)
          throw new Error("Migration lock mutation is busy");
        try {
          const renewedContent = leaseContent(input.process, input.clock, leaseDurationMs);
          if (!mutation(renewedContent))
            throw new Error("Migration lock ownership was lost");
          ownedContent = renewedContent;
        } finally {
          releaseMutationGuard({ env: input.env, fileSystem: input.fileSystem, content: guardContent2 });
        }
      };
      return {
        release: () => {
          const guardContent2 = acquireMutationGuard(input);
          if (guardContent2 === null) {
            input.fileSystem.removeIfContentsMatchSync(path, ownedContent);
            return;
          }
          try {
            input.fileSystem.removeIfContentsMatchSync(path, ownedContent);
          } finally {
            releaseMutationGuard({ env: input.env, fileSystem: input.fileSystem, content: guardContent2 });
          }
        },
        renew: () => {
          mutate((renewedContent) => input.fileSystem.replaceIfContentsMatchSync(path, ownedContent, renewedContent));
        }
      };
    } catch (error) {
      if (!isFileExistsError3(error))
        throw error;
    }
    const guardContent = acquireMutationGuard(input);
    if (guardContent === null)
      return null;
    try {
      let observedContent;
      try {
        observedContent = input.fileSystem.readFileSync(path, "utf-8");
      } catch (error) {
        if (isFileMissingError(error))
          continue;
        throw error;
      }
      const observed = parseLockRecord(observedContent);
      if (observed !== null && !isReclaimable(observed, input.clock, input.process, leaseDurationMs))
        return null;
      input.fileSystem.removeIfContentsMatchSync(path, observedContent);
    } finally {
      releaseMutationGuard({ env: input.env, fileSystem: input.fileSystem, content: guardContent });
    }
  }
  return null;
}

// ../../omo-config-core/src/migration/recovery.ts
function resumeMigrationJournal(input) {
  const journal = readMigrationJournal(input.fileSystem, input.env);
  if (journal === null)
    return false;
  input.renewLock();
  const target = targetDocument(journal.targetPath, input.fileSystem);
  if (!hasMigrationMarker(target, journal.migrationId)) {
    const prepared = journal.targetWrite.mode === "replace-target" ? prepareTargetReplacement({
      document: journal.targetWrite.additions,
      migrationId: journal.migrationId,
      target,
      targetPath: journal.targetPath
    }) : prepareTargetWrite({
      additions: journal.targetWrite.additions,
      migrationId: journal.migrationId,
      target,
      targetPath: journal.targetPath
    });
    writePreparedTarget({
      env: input.env,
      fileSystem: input.fileSystem,
      prepared,
      targetPath: journal.targetPath,
      writeTarget: input.writeTarget
    });
  }
  const targetRecorded = { ...journal, targetWritten: true };
  writeMigrationJournal(targetRecorded, input.fileSystem, input.env, input.process, input.clock);
  for (const move of targetRecorded.backupMoves) {
    if (targetRecorded.completedMoves.includes(move.from))
      continue;
    input.renewLock();
    if (input.fileSystem.existsSync(move.from)) {
      if (input.fileSystem.existsSync(move.to)) {
        throw new MigrationTransactionError(`Migration backup path already exists: ${move.to}`);
      }
      moveMigrationBackup(input.fileSystem, move.from, move.to);
    } else if (!input.fileSystem.existsSync(move.to)) {
      throw new MigrationTransactionError(`Migration source and backup are both missing: ${move.from}`);
    }
    Object.assign(targetRecorded, { completedMoves: [...targetRecorded.completedMoves, move.from] });
    writeMigrationJournal(targetRecorded, input.fileSystem, input.env, input.process, input.clock);
  }
  removeMigrationJournal(input.fileSystem, input.env);
  return true;
}

// ../../omo-config-core/src/migration/batch.ts
function parseSource(path, content) {
  const parsed = parseJsoncSafe2(content);
  if (parsed.errors.length > 0) {
    const detail = parsed.errors.map((error) => `${error.message} at ${error.offset}`).join(", ");
    throw new MigrationTransactionError(`Migration source at ${path} is invalid JSONC: ${detail}`);
  }
  return parsed.data;
}
function loadSources(sources, fileSystem) {
  return sources.filter((source) => fileSystem.existsSync(source.path)).map((source) => ({ ...source, value: parseSource(source.path, fileSystem.readFileSync(source.path, "utf-8")) }));
}
function backupBasePath(source, migrationId) {
  return source.backupPath ?? `${source.path}.bak.${encodeURIComponent(migrationId)}`;
}
function backupMoves(sources, migrationId, fileSystem, protectedPaths) {
  const paths = new Set(sources.map((source) => source.path));
  const destinations = new Set;
  const moves = [];
  for (const source of sources) {
    if (!fileSystem.existsSync(source.path))
      continue;
    const basePath = backupBasePath(source, migrationId);
    let destination = basePath;
    let attempt = 1;
    while (fileSystem.existsSync(destination) || destinations.has(destination)) {
      if (source.backupPath !== undefined)
        throw new MigrationTransactionError(`Migration backup path already exists: ${destination}`);
      destination = `${basePath}.${attempt}`;
      attempt += 1;
    }
    if (paths.has(destination) || protectedPaths.has(destination))
      throw new MigrationTransactionError(`Migration backup path is protected: ${destination}`);
    destinations.add(destination);
    moves.push({ from: source.path, to: destination });
  }
  return moves;
}
function assertSafeSourcePaths(sources, protectedPaths) {
  const seen = new Set;
  for (const source of sources) {
    if (seen.has(source.path))
      throw new MigrationTransactionError(`Duplicate migration source: ${source.path}`);
    if (protectedPaths.has(source.path))
      throw new MigrationTransactionError(`Migration source is protected: ${source.path}`);
    seen.add(source.path);
  }
}
function directoryPath2(path) {
  return path.startsWith("/") ? posix3.dirname(path) : dirname5(path);
}
function ensureBackupDirectories(moves, fileSystem) {
  for (const move of moves)
    fileSystem.mkdirSync(directoryPath2(move.to), { recursive: true });
}
function transformResult(value) {
  if (isPlainObject3(value) && isPlainObject3(value.document) && Array.isArray(value.diagnostics) && value.diagnostics.every((diagnostic) => typeof diagnostic === "string")) {
    return { diagnostics: value.diagnostics, document: value.document };
  }
  if (!isPlainObject3(value))
    throw new MigrationTransactionError("Migration transform must return a plain object");
  return { diagnostics: [], document: value };
}
function executePlan(input) {
  const { env, fileSystem, journalResumed, plan } = input;
  const protectedPaths = new Set([plan.targetPath, migrationJournalPath(env), migrationLockPath(env)]);
  assertSafeSourcePaths(plan.sources, protectedPaths);
  const existingSources = plan.sources.filter((source) => fileSystem.existsSync(source.path));
  const target = targetDocument(plan.targetPath, fileSystem);
  const replaceTarget = plan.mode === "replace-target";
  if (!shouldRunMigration({
    legacySourcesExist: replaceTarget ? fileSystem.existsSync(plan.targetPath) : existingSources.length > 0,
    migrationId: plan.id,
    target
  })) {
    return { diagnostics: [], journalResumed, status: "skipped" };
  }
  const loaded = replaceTarget ? [{ path: plan.targetPath, value: target }] : loadSources(existingSources, fileSystem);
  const transformed = transformResult(plan.transform(loaded));
  const prepared = replaceTarget ? prepareTargetReplacement({ document: transformed.document, migrationId: plan.id, target, targetPath: plan.targetPath }) : prepareTargetWrite({ additions: transformed.document, migrationId: plan.id, target, targetPath: plan.targetPath });
  const diagnostics = [...transformed.diagnostics, ...prepared.diagnostics];
  const moves = backupMoves(existingSources, plan.id, fileSystem, protectedPaths);
  const preview = { backupMoves: moves, targetPath: plan.targetPath, transform: transformed.document };
  if (input.dryRun)
    return { diagnostics, journalResumed, preview, status: "planned" };
  ensureBackupDirectories(moves, fileSystem);
  const journal = {
    backupMoves: moves,
    completedMoves: [],
    diagnostics,
    migrationId: plan.id,
    targetPath: plan.targetPath,
    targetWrite: {
      additions: transformed.document,
      ...replaceTarget ? { mode: "replace-target" } : {}
    },
    targetWritten: false,
    version: 1
  };
  writeMigrationJournal(journal, fileSystem, env, input.process, input.clock);
  input.onBoundary?.("journal-written");
  input.renewLock();
  writePreparedTarget({ env, fileSystem, prepared, targetPath: plan.targetPath, writeTarget: input.writeTarget });
  input.onBoundary?.("target-written");
  const targetRecorded = { ...journal, targetWritten: true };
  writeMigrationJournal(targetRecorded, fileSystem, env, input.process, input.clock);
  input.onBoundary?.("target-recorded");
  for (const move of targetRecorded.backupMoves) {
    input.renewLock();
    if (fileSystem.existsSync(move.to))
      throw new MigrationTransactionError(`Migration backup path already exists: ${move.to}`);
    moveMigrationBackup(fileSystem, move.from, move.to);
    input.onBoundary?.("source-moved");
    Object.assign(targetRecorded, { completedMoves: [...targetRecorded.completedMoves, move.from] });
    writeMigrationJournal(targetRecorded, fileSystem, env, input.process, input.clock);
    input.onBoundary?.("source-recorded");
  }
  removeMigrationJournal(fileSystem, env);
  return { diagnostics, journalResumed, preview, status: "migrated" };
}
function runMigrations(options) {
  const clock = options.clock ?? DEFAULT_MIGRATION_CLOCK;
  const home = globalThis.process.env["HOME"];
  const userProfile = globalThis.process.env["USERPROFILE"];
  const env = options.env ?? { ...home === undefined ? {} : { HOME: home }, ...userProfile === undefined ? {} : { USERPROFILE: userProfile } };
  const fileSystem = options.fileSystem ?? DEFAULT_MIGRATION_FILE_SYSTEM;
  const process3 = { isAlive: options.isProcessAlive ?? DEFAULT_MIGRATION_PROCESS.isAlive, pid: options.pid ?? DEFAULT_MIGRATION_PROCESS.pid };
  const writeTarget = options.writeTarget ?? writeOmoMigrationTarget;
  const lock = acquireMigrationLock({ clock, env, fileSystem, ...options.leaseDurationMs === undefined ? {} : { leaseDurationMs: options.leaseDurationMs }, process: process3 });
  if (lock === null)
    return { journalResumed: false, results: [], status: "locked" };
  try {
    const journalResumed = resumeMigrationJournal({ clock, env, fileSystem, process: process3, renewLock: lock.renew, writeTarget });
    lock.renew();
    const results = options.discover().map((plan) => executePlan({
      clock,
      dryRun: options.dryRun ?? false,
      env,
      fileSystem,
      journalResumed,
      onBoundary: options.onBoundary,
      plan,
      process: process3,
      renewLock: lock.renew,
      writeTarget
    }));
    if (options.dryRun !== true)
      options.afterMigrations?.(results);
    return { journalResumed, results, status: "completed" };
  } finally {
    lock.release();
  }
}

// shared/src/config-migration.ts
import { existsSync as existsSync5 } from "node:fs";
import { posix as posix4, win32 } from "node:path";
var MIGRATION_ID = "2026-07-codex-config-jsonc";
var OMO_SCHEMA_URL = "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json";
function isRecord5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function recordAt(value, key) {
  const candidate = value[key];
  return isRecord5(candidate) ? candidate : undefined;
}
function migrationHistory(sources, configPath) {
  const history = [];
  for (const source of sources) {
    if (!isRecord5(source.value))
      continue;
    for (const key of ["_migrations", "appliedMigrations"]) {
      const values = source.value[key];
      if (!Array.isArray(values))
        continue;
      for (const value of values) {
        if (typeof value === "string" && !history.includes(value))
          history.push(value);
      }
    }
  }
  return history.length === 0 ? {} : { [configPath]: history };
}
function transformConfigJsonc(configPath, sources) {
  const config2 = sources.find((source) => source.path === configPath);
  const legacy = config2 === undefined || !isRecord5(config2.value) ? {} : config2.value;
  const omo = recordAt(legacy, "[omo]");
  const senpi = recordAt(legacy, "[senpi]");
  const history = migrationHistory(sources, configPath);
  return {
    diagnostics: omo !== undefined && senpi !== undefined ? ["conflict: [senpi] legacy [omo] kept [senpi]"] : [],
    document: {
      $schema: OMO_SCHEMA_URL,
      ...recordAt(legacy, "codegraph") === undefined ? {} : { codegraph: recordAt(legacy, "codegraph") },
      ...recordAt(legacy, "[opencode]") === undefined ? {} : { "[opencode]": recordAt(legacy, "[opencode]") },
      ...recordAt(legacy, "[codex]") === undefined ? {} : { "[codex]": recordAt(legacy, "[codex]") },
      ...senpi === undefined && omo === undefined ? {} : { "[senpi]": senpi ?? omo },
      ...Object.keys(history).length === 0 ? {} : { legacy_migrations: history }
    }
  };
}
function timestamp(value) {
  return value ?? new Date().toISOString().replace(/[:.]/g, "-");
}
function sourceExists(options, path) {
  return (options.discoveryFileSystem ?? options.fileSystem ?? { existsSync: existsSync5 }).existsSync(path);
}
function migrationPlan(homeDir, options) {
  const platform = options.platform ?? process.platform;
  const paths = options.pathOperations ?? (platform === "win32" ? win32 : posix4);
  const configPath = paths.join(homeDir, ".omo", "config.jsonc");
  const sidecarPath = `${configPath}.migrations.json`;
  const sourcePaths = [configPath, sidecarPath].filter((path) => sourceExists(options, path));
  if (sourcePaths.length === 0)
    return;
  const backupRoot = paths.join(homeDir, ".omo", `migration-backup-${timestamp(options.backupTimestamp)}-opencode-config`, ".omo");
  return {
    id: MIGRATION_ID,
    sources: sourcePaths.map((path) => ({
      backupPath: paths.join(backupRoot, path === configPath ? "config.jsonc" : "config.jsonc.migrations.json"),
      path
    })),
    targetPath: paths.join(homeDir, ".omo", "omo.jsonc"),
    transform: (sources) => transformConfigJsonc(configPath, sources)
  };
}
function migratedSources(results) {
  return [...new Set(results.flatMap((result) => result.status === "migrated" ? result.preview?.backupMoves.map((move) => move.from) ?? [] : []))].sort();
}
function runCodexConfigMigration(options) {
  const environment = options.environment ?? process.env;
  const homeDir = options.homeDir ?? environment["HOME"] ?? environment["USERPROFILE"];
  if (homeDir === undefined || homeDir.length === 0) {
    return { error: "Cannot migrate configuration because no home directory is available", journalResumed: false, migratedFrom: [], results: [] };
  }
  try {
    const batch = runMigrations({
      ...options.clock === undefined ? {} : { clock: options.clock },
      discover: () => {
        const plan = migrationPlan(homeDir, options);
        return plan === undefined ? [] : [plan];
      },
      ...options.env === undefined ? { env: { HOME: homeDir } } : { env: options.env },
      ...options.fileSystem === undefined ? {} : { fileSystem: options.fileSystem },
      ...options.isProcessAlive === undefined ? {} : { isProcessAlive: options.isProcessAlive },
      ...options.onBoundary === undefined ? {} : { onBoundary: options.onBoundary },
      ...options.pid === undefined ? {} : { pid: options.pid }
    });
    return {
      ...batch.status === "locked" ? { error: "Configuration migration is already running" } : {},
      journalResumed: batch.journalResumed,
      migratedFrom: migratedSources(batch.results),
      results: batch.results
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      journalResumed: false,
      migratedFrom: [],
      results: []
    };
  }
}

// shared/src/config-loader.ts
var ENV_BOOLEAN_SETTINGS = [
  ["auto_provision", "AUTO_PROVISION"],
  ["enabled", "ENABLED"],
  ["telemetry", "TELEMETRY"]
];
function resolveHomeDir2(options) {
  const env = options.env ?? process.env;
  return options.homeDir ?? env.HOME ?? env.USERPROFILE ?? homedir5();
}
function environmentWithHome(env, homeDir) {
  return { ...env, HOME: homeDir };
}
function migrationEnvironment(homeDir, env) {
  return {
    HOME: homeDir,
    ...env.USERPROFILE === undefined ? {} : { USERPROFILE: env.USERPROFILE }
  };
}
function runCodexStartupMigration(options) {
  return runCodexConfigMigration(options);
}
function parseBoolean(value) {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized))
    return true;
  if (["0", "false", "no", "off"].includes(normalized))
    return false;
  return;
}
function envOverrides(env, warnings) {
  const codegraph = {};
  for (const prefix of ["OMO", "CODEX"]) {
    for (const [setting, suffix] of ENV_BOOLEAN_SETTINGS) {
      const name = `${prefix}_CODEGRAPH_${suffix}`;
      const rawValue = env[name];
      if (rawValue === undefined)
        continue;
      const value = parseBoolean(rawValue);
      if (value === undefined)
        warnings.push(`${name} has invalid boolean value "${rawValue}"`);
      else
        codegraph[setting] = value;
    }
    const installDir = env[`${prefix}_CODEGRAPH_INSTALL_DIR`];
    if (installDir !== undefined)
      codegraph["install_dir"] = installDir;
    const cooldown = env[`${prefix}_CODEGRAPH_SESSION_START_COOLDOWN_MS`];
    if (cooldown !== undefined) {
      const value = Number(cooldown);
      if (!Number.isFinite(value) || value < 60000) {
        warnings.push(`${prefix}_CODEGRAPH_SESSION_START_COOLDOWN_MS has invalid number value "${cooldown}"`);
      } else
        codegraph["session_start_cooldown_ms"] = value;
    }
    const debounce = env[`${prefix}_CODEGRAPH_WATCH_DEBOUNCE_MS`];
    if (debounce !== undefined) {
      const value = Number(debounce);
      if (!Number.isFinite(value) || value < 0)
        warnings.push(`${prefix}_CODEGRAPH_WATCH_DEBOUNCE_MS has invalid number value "${debounce}"`);
      else
        codegraph["watch_debounce_ms"] = value;
    }
  }
  return Object.keys(codegraph).length === 0 ? {} : { codegraph };
}
function migrationWarnings(result) {
  const warnings = [];
  if (result.error !== undefined)
    warnings.push(`omo-codex: configuration migration: ${result.error}`);
  if (result.journalResumed)
    warnings.push("omo-codex: recovered an interrupted configuration migration");
  if (result.migratedFrom.length > 0) {
    warnings.push(`omo-codex: migrated legacy configuration from ${result.migratedFrom.join(", ")}`);
  }
  for (const migration of result.results) {
    for (const diagnostic of migration.diagnostics) {
      warnings.push(`omo-codex: configuration migration: ${diagnostic}`);
    }
  }
  return warnings;
}
function applicabilityWarnings(config2) {
  return config2.codegraph?.watch_debounce_ms === undefined ? [] : ["codegraph.watch_debounce_ms is not supported for harness codex"];
}
function codexCodegraphConfig(value) {
  if (value === undefined)
    return;
  return {
    auto_provision: value.auto_provision,
    daemon: value.daemon,
    enabled: value.enabled,
    telemetry: value.telemetry,
    ...value.excluded_roots === undefined ? {} : { excluded_roots: value.excluded_roots },
    ...value.install_dir === undefined ? {} : { install_dir: value.install_dir },
    ...value.session_start_cooldown_ms === undefined ? {} : { session_start_cooldown_ms: value.session_start_cooldown_ms },
    ...value.watch_debounce_ms === undefined ? {} : { watch_debounce_ms: value.watch_debounce_ms }
  };
}
function getCodexOmoConfig(options = {}) {
  const env = options.env ?? process.env;
  const homeDir = resolveHomeDir2(options);
  const environment = environmentWithHome(env, homeDir);
  const migration = runCodexStartupMigration({
    cwd: options.cwd ?? process.cwd(),
    environment,
    env: migrationEnvironment(homeDir, environment),
    ...options.fileSystem === undefined ? {} : { fileSystem: options.fileSystem },
    ...options.platform === undefined ? {} : { platform: options.platform }
  });
  const result = loadOmoConfig({
    ...options.cwd === undefined ? {} : { cwd: options.cwd },
    env: environment,
    ...options.fileSystem === undefined ? {} : { fileSystem: options.fileSystem },
    harness: "codex",
    ...options.platform === undefined ? {} : { platform: options.platform },
    ...options.profile === undefined ? {} : { profile: options.profile }
  });
  const trustedConfig = loadOmoConfig({
    cwd: homeDir,
    env: environment,
    ...options.fileSystem === undefined ? {} : { fileSystem: options.fileSystem },
    harness: "codex",
    ...options.platform === undefined ? {} : { platform: options.platform },
    ...options.profile === undefined ? {} : { profile: options.profile }
  });
  const envWarnings = [];
  const config2 = OmoConfigSchema.parse(mergeOmoConfigRecords(result.config, envOverrides(env, envWarnings)));
  const trustedCodegraphInstallDir = trustedConfig.config.codegraph?.install_dir;
  const { codegraph, ...resolvedConfig } = config2;
  const codexCodegraph = codexCodegraphConfig(codegraph);
  return {
    ...resolvedConfig,
    ...codexCodegraph === undefined ? {} : { codegraph: codexCodegraph },
    sources: result.sources,
    ...trustedCodegraphInstallDir === undefined ? {} : { trustedCodegraphInstallDir },
    warnings: [
      ...migrationWarnings(migration),
      ...result.diagnostics.map((diagnostic) => diagnostic.message),
      ...envWarnings,
      ...applicabilityWarnings(config2)
    ]
  };
}

// components/codegraph/src/cache-gc.ts
var NON_FATAL_GC_ERROR_CODES = new Set(["EACCES", "EBUSY", "ENOENT", "ENOTEMPTY", "ENOTDIR", "EPERM"]);
function pruneCodegraphProjectStoresBestEffort(homeDir, options = {}) {
  try {
    (options.prune ?? pruneDeadCodegraphProjectStores)({ homeDir });
  } catch (error) {
    if (!isNonFatalCodegraphGcError(error))
      throw error;
    options.debugLog?.(`CodeGraph cache GC skipped: ${error.message}`);
  }
}
function isNonFatalCodegraphGcError(error) {
  if (!(error instanceof Error))
    return false;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return typeof code === "string" && NON_FATAL_GC_ERROR_CODES.has(code);
}

// components/codegraph/src/hook-input.ts
import { homedir as homedir6 } from "node:os";
function resolveHomeDir3(env) {
  return env["HOME"] ?? env["USERPROFILE"] ?? homedir6();
}
function resolveHookProjectRoot(input, fallback) {
  if (!isRecord6(input))
    return fallback;
  const cwd = input["cwd"];
  return typeof cwd === "string" && cwd.trim().length > 0 ? cwd : fallback;
}
async function readHookInput(stdin) {
  if (stdin.isTTY === true)
    return;
  let text = "";
  for await (const chunk of stdin)
    text += typeof chunk === "string" ? chunk : String(chunk);
  if (text.trim().length === 0)
    return;
  return parseJson(text);
}
function isRecord6(value) {
  return typeof value === "object" && value !== null;
}
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError)
      return;
    throw error;
  }
}

// components/codegraph/src/hook-sweep.ts
import { fileURLToPath } from "node:url";
// ../../utils/src/process-sweep/family-sweeper.ts
import { existsSync as existsSync6, mkdirSync as mkdirSync3, statSync as statSync2, utimesSync, writeFileSync as writeFileSync3 } from "node:fs";
import { dirname as dirname6 } from "node:path";

// ../../utils/src/process-sweep/exec.ts
import { execFile } from "node:child_process";

// ../../utils/src/process-sweep/process-table.ts
function parsePosixProcessTable(output) {
  const processes = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (match === null)
      continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    const command = match[3];
    if (!isValidProcessId(pid) || !Number.isInteger(ppid) || ppid < 0 || command === undefined)
      continue;
    processes.push({ command, pid, ppid });
  }
  return processes;
}
function parseWindowsProcessTable(output) {
  const parsed = parseJson2(output);
  const entries = Array.isArray(parsed) ? parsed : parsed === undefined ? [] : [parsed];
  const processes = [];
  for (const entry of entries) {
    if (!isRecord7(entry))
      continue;
    const pid = numberField(entry, "ProcessId");
    const ppid = numberField(entry, "ParentProcessId");
    const command = stringField(entry, "CommandLine");
    if (pid === undefined || ppid === undefined || command === undefined || command.trim().length === 0)
      continue;
    processes.push({ command, pid, ppid });
  }
  return processes;
}
function isOrphaned(processInfo, livePids) {
  return processInfo.ppid === 1 || !livePids.has(processInfo.ppid);
}
function isValidProcessId(value) {
  return Number.isSafeInteger(value) && value > 0;
}
function parseJson2(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError)
      return;
    throw error;
  }
}
function numberField(record2, key) {
  const value = record2[key];
  return typeof value === "number" && isValidProcessId(value) ? value : undefined;
}
function stringField(record2, key) {
  const value = record2[key];
  return typeof value === "string" ? value : undefined;
}
function isRecord7(value) {
  return typeof value === "object" && value !== null;
}

// ../../utils/src/process-sweep/exec.ts
function enumerateProcesses(platform = process.platform) {
  return platform === "win32" ? enumerateWindowsProcesses() : enumeratePosixProcesses();
}
function createDefaultProcessKiller(platform = process.platform) {
  return platform === "win32" ? createWindowsKiller() : createPosixKiller();
}
function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (!(error instanceof Error))
      throw error;
    return processKillErrorMeansAlive(error);
  }
}
function enumeratePosixProcesses() {
  return execFileText("ps", ["-eo", "pid=,ppid=,command="]).then(parsePosixProcessTable);
}
function enumerateWindowsProcesses() {
  const command = [
    "Get-CimInstance Win32_Process",
    "Select-Object ProcessId,ParentProcessId,CommandLine",
    "ConvertTo-Json -Compress -Depth 2"
  ].join(" | ");
  return execFileText("powershell.exe", ["-NoProfile", "-Command", command]).then(parseWindowsProcessTable);
}
function createPosixKiller() {
  return {
    isAlive: defaultIsProcessAlive,
    kill: (pid) => {
      process.kill(pid, "SIGKILL");
      return Promise.resolve();
    },
    terminate: (pid) => {
      process.kill(pid, "SIGTERM");
      return Promise.resolve();
    }
  };
}
function createWindowsKiller() {
  return {
    isAlive: defaultIsProcessAlive,
    kill: (pid) => execFileVoid("taskkill.exe", ["/PID", String(pid), "/T", "/F"]),
    terminate: (pid) => execFileVoid("taskkill.exe", ["/PID", String(pid), "/T"])
  };
}
function execFileText(command, args) {
  return new Promise((resolvePromise, reject) => {
    execFile(command, [...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolvePromise(stdout);
    });
  });
}
function execFileVoid(command, args) {
  return execFileText(command, args).then(() => {
    return;
  });
}
function processKillErrorMeansAlive(error) {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code === "ESRCH")
    return false;
  if (code === "EPERM")
    return true;
  return false;
}

// ../../utils/src/process-sweep/family-sweeper.ts
var DEFAULT_GRACE_MS = 2000;
var DEFAULT_THROTTLE_MS = 60 * 60 * 1000;
async function runProcessFamilySweep(config2, options) {
  const nowMs = options.nowMs ?? Date.now();
  const dryRun = options.dryRun === true;
  if (options.force !== true && isSweepThrottled(config2.stampFile, nowMs, options.throttleMs ?? DEFAULT_THROTTLE_MS)) {
    return { action: "throttled", candidates: [], dryRun, failed: [], killed: [], spared: [], stampFile: config2.stampFile };
  }
  try {
    const plan = await config2.collect();
    const { failed, killed } = dryRun ? { failed: [], killed: [] } : await killTargets(plan.killList, options, config2);
    if (!dryRun)
      writeSweepStamp(config2.stampFile, nowMs);
    return {
      action: "swept",
      candidates: plan.candidates,
      dryRun,
      failed,
      killed,
      spared: plan.spared,
      stampFile: config2.stampFile
    };
  } catch (error) {
    options.log?.(`${config2.familyLabel} skipped: ${error instanceof Error ? error.message : String(error)}`);
    return { action: "failed", candidates: [], dryRun, failed: [], killed: [], spared: [], stampFile: config2.stampFile };
  }
}
async function killTargets(targets, options, config2) {
  const failed = [];
  const killed = [];
  const context = {
    failed,
    familyLabel: config2.familyLabel,
    killer: options.killer ?? createDefaultProcessKiller(options.platform),
    log: options.log
  };
  for (const target of targets) {
    if (!await passesSignalAttestation(target, config2.attestBeforeSignal, options.log, "SIGTERM"))
      continue;
    const terminated = await safelyTerminate(target.pid, context);
    if (!terminated)
      continue;
    await delay(options.graceMs ?? DEFAULT_GRACE_MS);
    if (!await context.killer.isAlive(target.pid)) {
      killed.push(target);
      continue;
    }
    if (!await passesSignalAttestation(target, config2.attestBeforeSignal, options.log, "SIGKILL"))
      continue;
    if (await safelyKill(target.pid, context))
      killed.push(target);
  }
  return { failed, killed };
}
async function passesSignalAttestation(target, attest, log, signal) {
  if (attest === undefined)
    return true;
  try {
    const attested = await attest(target);
    if (!attested)
      log?.(`process sweep sparing pid ${target.pid}: identity changed before ${signal}`);
    return attested;
  } catch (error) {
    log?.(`process sweep sparing pid ${target.pid}: identity attestation failed before ${signal}: ${String(error)}`);
    return false;
  }
}
async function safelyTerminate(pid, context) {
  try {
    await context.killer.terminate(pid);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.failed.push({ error: message, pid, stage: "terminate" });
    context.log?.(`${context.familyLabel} failed to terminate pid ${pid}: ${message}`);
    return false;
  }
}
async function safelyKill(pid, context) {
  try {
    await context.killer.kill(pid);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.failed.push({ error: message, pid, stage: "kill" });
    context.log?.(`${context.familyLabel} failed to kill pid ${pid}: ${message}`);
    return false;
  }
}
function isSweepThrottled(stampFile, nowMs, throttleMs) {
  if (!existsSync6(stampFile))
    return false;
  return nowMs - statSync2(stampFile).mtimeMs < throttleMs;
}
function writeSweepStamp(stampFile, nowMs) {
  mkdirSync3(dirname6(stampFile), { recursive: true });
  writeFileSync3(stampFile, `${new Date(nowMs).toISOString()}
`);
  const stampDate = new Date(nowMs);
  utimesSync(stampFile, stampDate, stampDate);
}
function delay(ms) {
  if (ms <= 0)
    return Promise.resolve();
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

// ../../utils/src/process-sweep/command-match.ts
import { posix as posix5, win32 as win322 } from "node:path";
function splitCommandTokens(command) {
  const tokens = [];
  let current = "";
  let quote = null;
  let tokenStarted = false;
  for (const char of command) {
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (tokenStarted || current.length > 0) {
        tokens.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }
    current += char;
  }
  if (tokenStarted || current.length > 0)
    tokens.push(current);
  return tokens;
}
function hasExecutableToken(command, expectedPath) {
  let searchFrom = 0;
  for (;; ) {
    const pathIndex = command.indexOf(expectedPath, searchFrom);
    if (pathIndex < 0)
      return false;
    const tokenStart = findTokenStart(command, pathIndex);
    const tokenEnd = findTokenEnd(command, pathIndex + expectedPath.length);
    if (command.slice(tokenStart, tokenEnd) === expectedPath && tokenLooksExecutable(command, tokenStart))
      return true;
    searchFrom = pathIndex + expectedPath.length;
  }
}
function hasExecutableTokenUnderRootWithSuffix(command, root, suffix) {
  let searchFrom = 0;
  for (;; ) {
    const suffixIndex = command.indexOf(suffix, searchFrom);
    if (suffixIndex < 0)
      return false;
    const tokenStart = findTokenStart(command, suffixIndex);
    const tokenEnd = findTokenEnd(command, suffixIndex + suffix.length);
    const token = command.slice(tokenStart, tokenEnd);
    if (token.endsWith(suffix) && token.startsWith(`${root}/`) && tokenLooksExecutable(command, tokenStart))
      return true;
    searchFrom = suffixIndex + suffix.length;
  }
}
function tokenLooksExecutable(command, tokenStart) {
  let prefix = command.slice(0, tokenStart).trimEnd();
  if (prefix.length === 0)
    return true;
  for (;; ) {
    const previousTokenStart = findTokenStart(prefix, prefix.length - 1);
    const previousToken = prefix.slice(previousTokenStart);
    if (!previousToken.startsWith("-")) {
      const executableName = previousToken.split("/").at(-1) ?? previousToken;
      return /^node\d*(\.exe)?$/i.test(executableName) || /^bun(\.exe)?$/i.test(executableName);
    }
    prefix = prefix.slice(0, previousTokenStart).trimEnd();
    if (prefix.length === 0)
      return false;
  }
}
function findTokenStart(command, index) {
  for (let cursor = index - 1;cursor >= 0; cursor -= 1) {
    if (/\s|["']/.test(command[cursor] ?? ""))
      return cursor + 1;
  }
  return 0;
}
function findTokenEnd(command, index) {
  for (let cursor = index;cursor < command.length; cursor += 1) {
    if (/\s|["']/.test(command[cursor] ?? ""))
      return cursor;
  }
  return command.length;
}
function normalizeRoots(roots, platform) {
  const normalized = new Set;
  for (const root of roots) {
    const trimmed = root.trim();
    if (trimmed.length === 0)
      continue;
    normalized.add(normalizeForComparison2(resolvePathForPlatform(trimmed, platform), platform));
  }
  return [...normalized].sort((left, right) => right.length - left.length || left.localeCompare(right));
}
function resolvePathForPlatform(value, platform) {
  return platform === "win32" ? win322.resolve(value) : posix5.resolve(value);
}
function normalizeForComparison2(value, platform) {
  const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

// ../../utils/src/process-sweep/roots.ts
import { existsSync as existsSync7, readdirSync as readdirSync3, realpathSync as realpathSync5 } from "node:fs";
import { homedir as homedir7 } from "node:os";
import { join as join11, resolve as resolve6 } from "node:path";
function discoverCodegraphOwnedRoots(options = {}) {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? env["HOME"] ?? env["USERPROFILE"] ?? homedir7();
  const roots = new Set;
  addRoot(roots, options.trustedCodegraphInstallDir);
  addRoot(roots, buildCodegraphEnv({ homeDir })[CODEGRAPH_INSTALL_DIR_ENV]);
  addRoot(roots, join11(homeDir, ".claude", "omo"));
  addRoot(roots, options.pluginRoot);
  for (const root of options.extraRoots ?? [])
    addRoot(roots, root);
  for (const root of readCodexPluginCacheRoots(options.codexHome ?? env["CODEX_HOME"] ?? join11(homeDir, ".codex"))) {
    addRoot(roots, root);
  }
  return [...roots];
}
function readCodexPluginCacheRoots(codexHome) {
  const cacheRoot = join11(codexHome, "plugins", "cache");
  if (!existsSync7(cacheRoot))
    return [];
  const roots = [];
  for (const publisher of safeReadDir(cacheRoot)) {
    if (!OMO_CODEX_PLUGIN_CACHE_PUBLISHERS.has(publisher))
      continue;
    const omoRoot = join11(cacheRoot, publisher, "omo");
    if (!existsSync7(omoRoot))
      continue;
    for (const version2 of safeReadDir(omoRoot))
      roots.push(join11(omoRoot, version2));
  }
  return roots;
}
function addRoot(roots, root) {
  if (root === undefined || root.trim().length === 0)
    return;
  const resolved = resolve6(root);
  roots.add(resolved);
  roots.add(realpathIfPossible2(resolved));
}
function safeReadDir(path) {
  try {
    return readdirSync3(path, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (isNonFatalFsError(error))
      return [];
    throw error;
  }
}
function realpathIfPossible2(path) {
  try {
    return realpathSync5(path);
  } catch (error) {
    if (error instanceof Error)
      return resolve6(path);
    throw error;
  }
}
function isNonFatalFsError(error) {
  if (!(error instanceof Error))
    return false;
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  return typeof code === "string" && ["EACCES", "ENOENT", "ENOTDIR", "EPERM"].includes(code);
}
var OMO_CODEX_PLUGIN_CACHE_PUBLISHERS = new Set(["sisyphuslabs"]);

// ../../utils/src/process-sweep/codegraph-sweeper.ts
import { homedir as homedir8 } from "node:os";
import { join as join13 } from "node:path";

// ../../utils/src/codegraph/daemon-lock.ts
import { readFileSync as readFileSync5, realpathSync as realpathSync6 } from "node:fs";
import { dirname as dirname7, join as join12, resolve as resolve7 } from "node:path";
function parseDaemonLock(raw) {
  const trimmed = raw.trim();
  if (trimmed.length === 0)
    return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null && "pid" in parsed) {
      const pid = parsed.pid;
      if (typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0) {
        const record2 = parsed;
        return {
          pid,
          ...typeof record2["socketPath"] === "string" ? { socketPath: record2["socketPath"] } : {},
          ...typeof record2["startedAt"] === "number" ? { startedAt: record2["startedAt"] } : {},
          ...typeof record2["version"] === "string" ? { version: record2["version"] } : {}
        };
      }
    }
    return null;
  } catch (error) {
    if (!(error instanceof SyntaxError))
      throw error;
  }
  const legacyPid = Number(trimmed);
  if (Number.isSafeInteger(legacyPid) && legacyPid > 0)
    return { pid: legacyPid };
  return null;
}
function daemonLockCandidates(projectRoot) {
  const dirs = new Set;
  const resolved = resolve7(projectRoot);
  collectAncestors(resolved, dirs);
  collectAncestors(realpathIfPossible3(resolved), dirs);
  return [...dirs].map((dir) => join12(dir, ".codegraph", "daemon.pid"));
}
function evaluateDaemonStaleness(pid, projectRoot) {
  let sawLock = false;
  for (const lockPath of daemonLockCandidates(projectRoot)) {
    const raw = readLockIfPresent(lockPath);
    if (raw === undefined)
      continue;
    if (raw === null)
      return { stale: false, reason: "lock-unreadable" };
    sawLock = true;
    const lock = parseDaemonLock(raw);
    if (lock === null)
      return { stale: false, reason: "lock-unparseable" };
    if (lock.pid === pid)
      return { stale: false, reason: "lock-pid-match" };
  }
  return sawLock ? { stale: true, reason: "lock-pid-mismatch" } : { stale: true, reason: "lock-absent" };
}
function readLockIfPresent(lockPath) {
  try {
    return readFileSync5(lockPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    if (error instanceof Error && "code" in error && error.code === "ENOTDIR")
      return;
    return null;
  }
}
function collectAncestors(start, output) {
  let current = start;
  for (;; ) {
    output.add(current);
    const parent = dirname7(current);
    if (parent === current)
      return;
    current = parent;
  }
}
function realpathIfPossible3(path) {
  try {
    return realpathSync6(path);
  } catch (error) {
    if (error instanceof Error)
      return path;
    throw error;
  }
}

// ../../utils/src/process-sweep/codegraph-family.ts
var SERVE_WRAPPER_SUFFIX = "/components/codegraph/dist/serve.js";
var UPSTREAM_PACKAGE_PATTERN = /\/@colbymchenry\/codegraph(?:-(?:darwin|linux|win32)-(?:arm64|x64))?\//g;
function selectZombieCodegraphProcesses(processes, options) {
  const platform = options.platform ?? process.platform;
  const livePids = new Set(processes.map((processInfo) => processInfo.pid));
  const processByPid = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]));
  const roots = normalizeRoots(options.ownedRoots, platform);
  const daemonMatches = new Map;
  const workerMatches = new Map;
  const ancestry = { livePids, processByPid, workerMatches };
  const zombies = [];
  for (const processInfo of processes) {
    const daemon = matchDaemonCommand(processInfo.command, roots, platform);
    if (daemon !== null) {
      daemonMatches.set(processInfo.pid, daemon);
      continue;
    }
    const worker = matchOwnedCodegraphCommand(processInfo.command, roots, platform);
    if (worker !== null)
      workerMatches.set(processInfo.pid, worker);
  }
  for (const processInfo of processes) {
    const daemon = daemonMatches.get(processInfo.pid);
    if (daemon !== undefined) {
      if (!isOrphaned(processInfo, livePids))
        continue;
      zombies.push({
        ...processInfo,
        daemonProjectRoot: daemon.projectRoot,
        matchedRoot: daemon.root,
        matchKind: "upstream-daemon"
      });
      continue;
    }
    const worker = workerMatches.get(processInfo.pid);
    if (worker === undefined)
      continue;
    if (!isOrphaned(processInfo, livePids) && !hasOrphanedWorkerAncestor(processInfo, ancestry))
      continue;
    zombies.push({ ...processInfo, matchedRoot: worker.root, matchKind: worker.kind });
  }
  return zombies;
}
var STANDALONE_LAUNCHER_SUFFIXES = ["/bin/codegraph", "/bin/codegraph.exe"];
var BUNDLE_SCRIPT_SUFFIX = "/lib/dist/bin/codegraph.js";
function matchDaemonCommand(command, roots, platform) {
  const projectRoot = extractDaemonProjectRoot(splitCommandTokens(command));
  if (projectRoot === null)
    return null;
  const normalizedCommand = normalizeForComparison2(command, platform);
  for (const root of roots) {
    if (root.length === 0)
      continue;
    if (upstreamPackagePathIsUnderRoot(normalizedCommand, root))
      return { projectRoot, root };
    for (const suffix of STANDALONE_LAUNCHER_SUFFIXES) {
      if (hasExecutableToken(normalizedCommand, `${root}${suffix}`))
        return { projectRoot, root };
    }
    if (hasExecutableTokenUnderRootWithSuffix(normalizedCommand, root, BUNDLE_SCRIPT_SUFFIX))
      return { projectRoot, root };
  }
  return null;
}
function extractDaemonProjectRoot(tokens) {
  if (!tokens.includes("serve") || !tokens.includes("--mcp"))
    return null;
  const pathIndex = tokens.indexOf("--path");
  if (pathIndex < 0)
    return null;
  const value = tokens[pathIndex + 1];
  if (value === undefined || value.length === 0 || value.startsWith("--"))
    return null;
  return value;
}
function matchOwnedCodegraphCommand(command, roots, platform) {
  const normalizedCommand = normalizeForComparison2(command, platform);
  for (const root of roots) {
    if (root.length === 0)
      continue;
    const serveWrapper = `${root}${SERVE_WRAPPER_SUFFIX}`;
    if (hasExecutableToken(normalizedCommand, serveWrapper))
      return { kind: "serve-wrapper", root };
    if (hasExecutableTokenUnderRootWithSuffix(normalizedCommand, root, BUNDLE_SCRIPT_SUFFIX) || hasExecutableToken(normalizedCommand, `${root}/npm-shim.js`) || upstreamPackagePathIsUnderRoot(normalizedCommand, root)) {
      return { kind: "upstream-codegraph", root };
    }
  }
  return null;
}
function upstreamPackagePathIsUnderRoot(command, root) {
  UPSTREAM_PACKAGE_PATTERN.lastIndex = 0;
  for (;; ) {
    const match = UPSTREAM_PACKAGE_PATTERN.exec(command);
    if (match === null)
      return false;
    const tokenStart = findTokenStart(command, match.index);
    if (command.slice(tokenStart).startsWith(`${root}/`) && tokenLooksExecutable(command, tokenStart))
      return true;
  }
}
function hasOrphanedWorkerAncestor(processInfo, ancestry) {
  const visited = new Set;
  let parentPid = processInfo.ppid;
  for (;; ) {
    if (visited.has(parentPid))
      return false;
    visited.add(parentPid);
    const parent = ancestry.processByPid.get(parentPid);
    if (parent === undefined || !ancestry.workerMatches.has(parent.pid))
      return false;
    if (isOrphaned(parent, ancestry.livePids))
      return true;
    parentPid = parent.ppid;
  }
}

// ../../utils/src/process-sweep/codegraph-sweeper.ts
var CODEGRAPH_DAEMON_SWEEP_STAMP_FILE = "zombie-sweep.stamp";
var CODEGRAPH_WORKER_SWEEP_STAMP_FILE = "worker-sweep.stamp";
async function sweepCodegraphZombies(options = {}) {
  const homeDir = options.homeDir ?? options.env?.["HOME"] ?? options.env?.["USERPROFILE"] ?? homedir8();
  const dataRoot = codegraphDataRoot(homeDir);
  const daemonStampFile = join13(dataRoot, CODEGRAPH_DAEMON_SWEEP_STAMP_FILE);
  const workerStampFile = join13(dataRoot, CODEGRAPH_WORKER_SWEEP_STAMP_FILE);
  const ownedRoots = options.ownedRoots ?? discoverCodegraphOwnedRoots(options);
  const provider = options.processProvider ?? (() => enumerateProcesses(options.platform));
  let candidatesPromise;
  const collectCandidates = () => {
    candidatesPromise ??= provider().then((processes) => selectZombieCodegraphProcesses(processes, {
      ownedRoots,
      ...options.platform === undefined ? {} : { platform: options.platform }
    }));
    return candidatesPromise;
  };
  const [workerResult, daemonResult] = await Promise.all([
    runProcessFamilySweep({
      familyLabel: "CodeGraph worker sweep",
      stampFile: workerStampFile,
      collect: async () => {
        const candidates = (await collectCandidates()).filter((candidate) => candidate.matchKind !== "upstream-daemon");
        return { candidates, killList: candidates, spared: [] };
      }
    }, { ...options, force: true }),
    runProcessFamilySweep({
      familyLabel: "CodeGraph daemon sweep",
      stampFile: daemonStampFile,
      collect: async () => {
        const candidates = (await collectCandidates()).filter((candidate) => candidate.matchKind === "upstream-daemon");
        const { killList, spared } = partitionByDaemonStaleness(candidates, options.log);
        return { candidates, killList, spared };
      }
    }, options)
  ]);
  return {
    action: aggregateAction(workerResult.action, daemonResult.action),
    candidates: [...workerResult.candidates, ...daemonResult.candidates],
    daemonAction: daemonResult.action,
    daemonStampFile,
    dryRun: options.dryRun === true,
    failed: [...workerResult.failed, ...daemonResult.failed],
    killed: [...workerResult.killed, ...daemonResult.killed],
    ownedRoots,
    spared: daemonResult.spared,
    stampFile: daemonStampFile,
    workerAction: workerResult.action,
    workerStampFile
  };
}
function partitionByDaemonStaleness(candidates, log) {
  const killList = [];
  const spared = [];
  for (const candidate of candidates) {
    const staleness = evaluateDaemonStaleness(candidate.pid, candidate.daemonProjectRoot ?? candidate.matchedRoot);
    if (staleness.stale) {
      log?.(`CodeGraph daemon sweep sweeping stale daemon pid ${candidate.pid} (${staleness.reason})`);
      killList.push(candidate);
      continue;
    }
    log?.(`CodeGraph daemon sweep spared live daemon pid ${candidate.pid} (${staleness.reason})`);
    spared.push(candidate);
  }
  return { killList, spared };
}
function aggregateAction(workerAction, daemonAction) {
  if (workerAction === "failed" || daemonAction === "failed")
    return "failed";
  if (workerAction === "swept" || daemonAction === "swept")
    return "swept";
  return "throttled";
}
// components/codegraph/src/hook-sweep.ts
async function sweepCodegraphZombiesBestEffort(options, sweep = sweepCodegraphZombies) {
  try {
    await sweep({
      ...options,
      pluginRoot: defaultPluginRoot(),
      ...options.log === undefined ? {} : { log: options.log }
    });
  } catch (error) {
    options.log?.(`CodeGraph zombie sweep skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function defaultPluginRoot() {
  return fileURLToPath(new URL("../../..", import.meta.url));
}

// components/codegraph/src/session-start-cooldown.ts
import { mkdirSync as mkdirSync4, readFileSync as readFileSync6, rmSync as rmSync3 } from "node:fs";

// ../../utils/src/atomic-write.ts
import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync as renameSync2,
  rmSync as rmSync2,
  unlinkSync as unlinkSync2,
  writeFileSync as writeFileSync4
} from "node:fs";
import { randomUUID as randomUUID2 } from "node:crypto";
import { dirname as dirname8 } from "node:path";
var TOLERATED_FSYNC_CODES = new Set([
  "EPERM",
  "EACCES",
  "ENOTSUP",
  "EINVAL"
]);
function isToleratedFsyncError(error) {
  if (!(error instanceof Error))
    return false;
  const code = error.code;
  return code !== undefined && TOLERATED_FSYNC_CODES.has(code);
}
function tolerantFsyncSync(fileDescriptor, fsyncImpl) {
  try {
    fsyncImpl(fileDescriptor);
  } catch (error) {
    if (!isToleratedFsyncError(error))
      throw error;
  }
}
function writeFileAtomically(filePath, content, options = {}) {
  const platform = options.platform ?? process.platform;
  const fsyncImpl = options.fsyncSync ?? fsyncSync;
  const tempPath = `${filePath}.${process.pid}.${randomUUID2()}.tmp`;
  try {
    writeFileSync4(tempPath, content, "utf-8");
    const tempFileDescriptor = openSync(tempPath, "r+");
    try {
      tolerantFsyncSync(tempFileDescriptor, fsyncImpl);
    } finally {
      closeSync(tempFileDescriptor);
    }
    try {
      renameSync2(tempPath, filePath);
    } catch (error) {
      const isPermissionError = error instanceof Error && (error.message.includes("EPERM") || error.message.includes("EACCES"));
      if (platform !== "win32" || !isPermissionError)
        throw error;
      unlinkSync2(filePath);
      renameSync2(tempPath, filePath);
    }
    if (platform === "win32")
      return;
    const directoryFileDescriptor = openSync(dirname8(filePath), "r");
    try {
      tolerantFsyncSync(directoryFileDescriptor, fsyncImpl);
    } finally {
      closeSync(directoryFileDescriptor);
    }
  } finally {
    rmSync2(tempPath, { force: true });
  }
}

// components/codegraph/src/session-start-paths.ts
import { basename as basename3, dirname as dirname9, join as join14 } from "node:path";
function resolveSessionStartStatePaths(homeDir, projectRoot) {
  const canonicalProjectRoot = canonicalizeCodegraphPath(projectRoot);
  const workspacePaths = resolveCodegraphWorkspacePaths(canonicalProjectRoot, { homeDir });
  const projectKey = basename3(workspacePaths.dataDir);
  const stateDirectory = join14(workspacePaths.dataRoot, "session-start");
  return {
    canonicalProjectRoot,
    cooldownPath: join14(stateDirectory, "cooldowns", `${projectKey}.json`),
    lockPath: join14(stateDirectory, "locks", `${projectKey}.lock`),
    outcomePath: join14(workspacePaths.dataRoot, "session-start.jsonl"),
    stateDirectory
  };
}
function stateParent(path) {
  return dirname9(path);
}

// components/codegraph/src/session-start-cooldown.ts
var DEFAULT_SESSION_START_COOLDOWN_MS = 15 * 60 * 1000;
var MAX_SESSION_START_COOLDOWN_MS = 24 * 60 * 60 * 1000;
function readSessionStartCooldown(options) {
  const paths = resolveSessionStartStatePaths(options.homeDir, options.projectRoot);
  const state = readCooldownState(paths.cooldownPath, paths.canonicalProjectRoot);
  if (state.kind === "inconclusive")
    return state;
  if (state.kind === "missing")
    return { failureCount: 0, kind: "inactive" };
  const cooldownUntil = state.value.lastFailureAt + cooldownDuration(options.baseCooldownMs, state.value.failureCount, options.maxCooldownMs ?? MAX_SESSION_START_COOLDOWN_MS);
  return options.nowMs < cooldownUntil ? { cooldownUntil, failureCount: state.value.failureCount, kind: "active" } : { failureCount: state.value.failureCount, kind: "inactive" };
}
function recordSessionStartFailure(options) {
  const paths = resolveSessionStartStatePaths(options.homeDir, options.projectRoot);
  const existing = readCooldownState(paths.cooldownPath, paths.canonicalProjectRoot);
  const failureCount = existing.kind === "present" ? existing.value.failureCount + 1 : 1;
  const cooldownUntil = options.nowMs + cooldownDuration(options.baseCooldownMs, failureCount, options.maxCooldownMs ?? MAX_SESSION_START_COOLDOWN_MS);
  const state = {
    action: options.action,
    cooldownUntil,
    failureCount,
    lastFailureAt: options.nowMs,
    projectRoot: paths.canonicalProjectRoot,
    version: 1
  };
  mkdirSync4(stateParent(paths.cooldownPath), { recursive: true });
  writeFileAtomically(paths.cooldownPath, `${JSON.stringify(state)}
`);
  return state;
}
function clearSessionStartCooldown(options) {
  const path = resolveSessionStartStatePaths(options.homeDir, options.projectRoot).cooldownPath;
  rmSync3(path, { force: true });
}
function cooldownDuration(baseCooldownMs, failureCount, maxCooldownMs) {
  let duration3 = Math.min(baseCooldownMs, maxCooldownMs);
  for (let attempt = 1;attempt < failureCount && duration3 < maxCooldownMs; attempt += 1) {
    duration3 = Math.min(duration3 * 2, maxCooldownMs);
  }
  return duration3;
}
function readCooldownState(path, projectRoot) {
  try {
    const parsed = JSON.parse(readFileSync6(path, "utf8"));
    const state = parseCooldownState(parsed, projectRoot);
    return state === null ? { kind: "inconclusive", reason: "cooldown state is invalid" } : { kind: "present", value: state };
  } catch (error) {
    if (!(error instanceof Error))
      throw error;
    if (errorCode(error) === "ENOENT")
      return { kind: "missing" };
    return { kind: "inconclusive", reason: error.message };
  }
}
function parseCooldownState(value, projectRoot) {
  if (typeof value !== "object" || value === null)
    return null;
  const action = Reflect.get(value, "action");
  const cooldownUntil = Reflect.get(value, "cooldownUntil");
  const failureCount = Reflect.get(value, "failureCount");
  const lastFailureAt = Reflect.get(value, "lastFailureAt");
  const recordedRoot = Reflect.get(value, "projectRoot");
  const version2 = Reflect.get(value, "version");
  if (!isFailureAction(action))
    return null;
  if (typeof cooldownUntil !== "number" || !Number.isFinite(cooldownUntil))
    return null;
  if (typeof failureCount !== "number" || !Number.isInteger(failureCount) || failureCount < 1)
    return null;
  if (typeof lastFailureAt !== "number" || !Number.isFinite(lastFailureAt))
    return null;
  if (recordedRoot !== projectRoot || version2 !== 1)
    return null;
  return { action, cooldownUntil, failureCount, lastFailureAt, projectRoot: recordedRoot, version: version2 };
}
function isFailureAction(value) {
  return typeof value === "string" && [
    "failed",
    "skipped-probe-error",
    "skipped-status",
    "skipped-unavailable",
    "skipped-unsupported-node",
    "spawn-failed",
    "stale-lock",
    "timeout"
  ].includes(value);
}
function errorCode(error) {
  if (typeof error !== "object" || error === null)
    return;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

// components/codegraph/src/session-start-hook-runtime.ts
import { spawn } from "node:child_process";
function spawnDetachedSessionStartWorker(invocation) {
  const child = spawn(invocation.command, [...invocation.args], {
    detached: true,
    env: invocation.env,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}
function writeSessionStartNotice(stdout, notice) {
  stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: notice
    }
  })}
`);
}

// components/codegraph/src/session-start-lock.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { mkdirSync as mkdirSync5, readFileSync as readFileSync7, rmSync as rmSync4, statSync as statSync3, writeFileSync as writeFileSync5 } from "node:fs";
function acquireSessionStartLock(options) {
  const paths = resolveSessionStartStatePaths(options.homeDir, options.projectRoot);
  const lockPath = paths.lockPath;
  const canonicalOptions = { ...options, projectRoot: paths.canonicalProjectRoot };
  try {
    mkdirSync5(stateParent(lockPath), { recursive: true });
  } catch (error) {
    if (error instanceof Error)
      return { kind: "inconclusive", reason: error.message };
    throw error;
  }
  const initial = tryCreateLock(lockPath, canonicalOptions.projectRoot);
  if (initial.kind !== "locked")
    return initial;
  const snapshot = readLockSnapshot(lockPath);
  if (snapshot.kind === "missing")
    return tryCreateLock(lockPath, canonicalOptions.projectRoot);
  if (snapshot.kind === "inconclusive")
    return snapshot;
  if (canonicalOptions.nowMs - snapshot.mtimeMs < canonicalOptions.staleMs)
    return { kind: "locked" };
  return reclaimStaleLock(lockPath, snapshot, canonicalOptions);
}
function releaseSessionStartLock(lock) {
  const snapshot = readLockSnapshot(lock.path);
  if (snapshot.kind !== "present" || snapshot.token !== lock.token)
    return false;
  try {
    rmSync4(lock.path, { force: true });
    return true;
  } catch (error) {
    if (error instanceof Error)
      return false;
    throw error;
  }
}
function sessionStartLockIsOwned(lock) {
  const snapshot = readLockSnapshot(lock.path);
  return snapshot.kind === "present" && snapshot.token === lock.token;
}
function reclaimStaleLock(lockPath, staleSnapshot, options) {
  const reclaimPath = `${lockPath}.reclaim`;
  const reclaim = tryCreateMarker(reclaimPath);
  if (reclaim.kind !== "acquired")
    return reclaim;
  try {
    const current = readLockSnapshot(lockPath);
    if (current.kind === "inconclusive")
      return current;
    if (current.kind === "present") {
      const changed = current.raw !== staleSnapshot.raw || current.mtimeMs !== staleSnapshot.mtimeMs;
      if (changed || options.nowMs - current.mtimeMs < options.staleMs)
        return { kind: "locked" };
      rmSync4(lockPath, { force: true });
    }
    const acquired = tryCreateLock(lockPath, options.projectRoot);
    return acquired.kind === "acquired" ? { ...acquired, recoveredStale: true } : acquired;
  } catch (error) {
    if (error instanceof Error)
      return { kind: "inconclusive", reason: error.message };
    throw error;
  } finally {
    rmSync4(reclaimPath, { force: true });
  }
}
function tryCreateLock(lockPath, projectRoot) {
  const token = randomUUID3();
  try {
    writeFileSync5(lockPath, `${JSON.stringify({ projectRoot, token })}
`, {
      encoding: "utf8",
      flag: "wx",
      mode: 384
    });
    return { kind: "acquired", lock: { path: lockPath, token }, recoveredStale: false };
  } catch (error) {
    if (!(error instanceof Error))
      throw error;
    if (errorCode2(error) === "EEXIST")
      return { kind: "locked" };
    return { kind: "inconclusive", reason: error.message };
  }
}
function tryCreateMarker(path) {
  try {
    writeFileSync5(path, `${randomUUID3()}
`, { encoding: "utf8", flag: "wx", mode: 384 });
    return { kind: "acquired" };
  } catch (error) {
    if (!(error instanceof Error))
      throw error;
    if (errorCode2(error) === "EEXIST")
      return { kind: "locked" };
    return { kind: "inconclusive", reason: error.message };
  }
}
function readLockSnapshot(path) {
  try {
    const raw = readFileSync7(path, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null)
      return { kind: "inconclusive", reason: "lock body is not an object" };
    const token = Reflect.get(parsed, "token");
    if (typeof token !== "string" || token.length === 0)
      return { kind: "inconclusive", reason: "lock token is missing" };
    return { kind: "present", mtimeMs: statSync3(path).mtimeMs, raw, token };
  } catch (error) {
    if (!(error instanceof Error))
      throw error;
    if (errorCode2(error) === "ENOENT")
      return { kind: "missing" };
    return { kind: "inconclusive", reason: error.message };
  }
}
function errorCode2(error) {
  if (typeof error !== "object" || error === null)
    return;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

// components/codegraph/src/session-start-outcome.ts
import { appendFileSync as appendFileSync2, mkdirSync as mkdirSync6 } from "node:fs";
import { dirname as dirname10, join as join15 } from "node:path";
function appendSessionStartOutcome(homeDir, outcome, nowMs = Date.now()) {
  const path = join15(codegraphDataRoot(homeDir), "session-start.jsonl");
  mkdirSync6(dirname10(path), { recursive: true });
  appendFileSync2(path, `${JSON.stringify({ ...outcome, timestamp: new Date(nowMs).toISOString() })}
`);
}

// components/codegraph/src/session-start-project.ts
import { realpathSync as realpathSync7, statSync as statSync4 } from "node:fs";
import { dirname as dirname11, join as join16 } from "node:path";
function probeCodegraphProject(projectRoot, options = {}) {
  const resolved = resolveProjectRoot(projectRoot);
  if (resolved.kind === "inconclusive")
    return resolved;
  const probeDatabase = options.probeDatabase ?? probeDatabaseAt;
  const exact = probeResolvedExactProject(resolved.projectRoot, probeDatabase);
  if (exact.kind !== "uninitialized")
    return exact;
  return probeResolvedAncestors(resolved.projectRoot, probeDatabase);
}
function probeExactCodegraphProject(projectRoot, options = {}) {
  const resolved = resolveProjectRoot(projectRoot);
  if (resolved.kind === "inconclusive")
    return resolved;
  return probeResolvedExactProject(resolved.projectRoot, options.probeDatabase ?? probeDatabaseAt);
}
function probeCodegraphAncestors(projectRoot, options = {}) {
  const resolved = resolveProjectRoot(projectRoot);
  if (resolved.kind === "inconclusive")
    return resolved;
  return probeResolvedAncestors(resolved.projectRoot, options.probeDatabase ?? probeDatabaseAt);
}
function probeResolvedExactProject(projectRoot, probeDatabase) {
  const exact = probeDatabase(projectRoot);
  if (exact.kind === "present")
    return { kind: "initialized" };
  if (exact.kind === "inconclusive")
    return exact;
  return { kind: "uninitialized" };
}
function probeResolvedAncestors(projectRoot, probeDatabase) {
  let ancestorRoot = dirname11(projectRoot);
  while (ancestorRoot !== projectRoot) {
    const database = probeDatabase(ancestorRoot);
    if (database.kind === "present")
      return { ancestorRoot, kind: "nested-root" };
    if (database.kind === "inconclusive")
      return database;
    const parent = dirname11(ancestorRoot);
    if (parent === ancestorRoot)
      break;
    ancestorRoot = parent;
  }
  return { kind: "uninitialized" };
}
function resolveProjectRoot(projectRoot) {
  try {
    return { kind: "resolved", projectRoot: realpathSync7(projectRoot) };
  } catch (error) {
    if (error instanceof Error)
      return { kind: "inconclusive", reason: error.message };
    throw error;
  }
}
function probeDatabaseAt(directory) {
  try {
    statSync4(join16(directory, ".codegraph", "codegraph.db"));
    return { kind: "present" };
  } catch (error) {
    if (!(error instanceof Error))
      throw error;
    const code = errorCode3(error);
    if (code === "ENOENT" || code === "ENOTDIR")
      return { kind: "missing" };
    return { kind: "inconclusive", reason: error.message };
  }
}
function errorCode3(error) {
  if (typeof error !== "object" || error === null)
    return;
  const code = Reflect.get(error, "code");
  return typeof code === "string" ? code : undefined;
}

// components/codegraph/src/session-start-worker.ts
import { homedir as homedir11 } from "node:os";
import { cwd as processCwd, env as processEnv3 } from "node:process";

// ../../utils/src/codegraph/managed-runtime.ts
import { existsSync as existsSync8, readFileSync as readFileSync8 } from "node:fs";
import { join as join17, resolve as resolve8 } from "node:path";

// ../../utils/src/record-type-guard.ts
function isPlainRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ../../utils/src/codegraph/manifest.ts
var CODEGRAPH_PINNED_VERSION = "1.5.0";
var CODEGRAPH_PROVISION_MANIFEST = {
  assets: {
    "darwin-arm64": {
      executableName: "codegraph",
      sha256: "cf5ee435a6e44d097b2f98f2b7b8b9422bb1094844404efed82519c5da1af2cf",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.5.0/codegraph-darwin-arm64.tar.gz"
    },
    "darwin-x64": {
      executableName: "codegraph",
      sha256: "0a0ccc29bf7da9d10be1458d89d7e15c55927ae24cd95e9fa3de4bdfea059dde",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.5.0/codegraph-darwin-x64.tar.gz"
    },
    "linux-arm64": {
      executableName: "codegraph",
      sha256: "9f17750aedf45d51f68caae39ed21d6e2a7290b2326e5c53f95a165918ebd1d8",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.5.0/codegraph-linux-arm64.tar.gz"
    },
    "linux-x64": {
      executableName: "codegraph",
      sha256: "2ba65e87a1210b706bb1e67d5e48b5fc4a1935e43dbb3fb5f31c5597840d2e58",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.5.0/codegraph-linux-x64.tar.gz"
    },
    "win32-arm64": {
      executableName: "codegraph.cmd",
      sha256: "19e0237ea5d8928f705d60e339eb319e7ec37490a69585712933c1534f3c0bc2",
      url: "https://registry.npmjs.org/@colbymchenry/codegraph-win32-arm64/-/codegraph-win32-arm64-1.5.0.tgz"
    },
    "win32-x64": {
      executableName: "codegraph.cmd",
      sha256: "ef64c878acb129885c2d8306ddec6674af865810b4c0f6a9ba9fcd61e21ff9d8",
      url: "https://registry.npmjs.org/@colbymchenry/codegraph-win32-x64/-/codegraph-win32-x64-1.5.0.tgz"
    }
  },
  version: CODEGRAPH_PINNED_VERSION
};

// ../../utils/src/codegraph/managed-runtime.ts
function managedBinPath(installDir, platform) {
  return join17(installDir, "bin", platform === "win32" ? "codegraph.cmd" : "codegraph");
}
function hasCodegraphManagedInstall(installDir, options = {}) {
  const fileExists = options.fileExists ?? existsSync8;
  return fileExists(managedBinPath(installDir, options.platform ?? process.platform)) || fileExists(join17(installDir, ".provisioned"));
}
function resolvePinnedCodegraphBin(installDir, options = {}) {
  if (installDir === undefined)
    return null;
  const fileExists = options.fileExists ?? existsSync8;
  const readText = options.readText ?? ((filePath) => readFileSync8(filePath, "utf8"));
  const expectedBin = managedBinPath(installDir, options.platform ?? process.platform);
  const markerPath = join17(installDir, ".provisioned", `codegraph-${CODEGRAPH_PINNED_VERSION}.json`);
  if (!fileExists(expectedBin) || !fileExists(markerPath))
    return null;
  let markerText;
  try {
    markerText = readText(markerPath);
  } catch {
    return null;
  }
  const marker = parseProvisionMarker(markerText);
  if (marker === null || marker.version !== CODEGRAPH_PINNED_VERSION)
    return null;
  return resolve8(marker.binPath) === resolve8(expectedBin) ? expectedBin : null;
}
function parseProvisionMarker(text) {
  try {
    const value = JSON.parse(text);
    if (!isPlainRecord(value))
      return null;
    const binPath = value["binPath"];
    const version2 = value["version"];
    if (typeof binPath !== "string" || typeof version2 !== "string")
      return null;
    return { binPath, version: version2 };
  } catch (error) {
    if (error instanceof SyntaxError)
      return null;
    throw error;
  }
}

// ../../utils/src/codegraph/node-support.ts
var CODEGRAPH_MIN_NODE_MAJOR = 20;
var CODEGRAPH_BLOCKED_NODE_MAJOR = 25;
var CODEGRAPH_UNSAFE_NODE_ENV = "CODEGRAPH_ALLOW_UNSAFE_NODE";
var CODEGRAPH_NODE_BIN_ENV = "CODEGRAPH_NODE_BIN";
function evaluateCodegraphNodeSupport(options = {}) {
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const env = options.env ?? process.env;
  const override = (env[CODEGRAPH_UNSAFE_NODE_ENV]?.trim().length ?? 0) > 0;
  const major = parseNodeMajor(nodeVersion);
  if (major >= CODEGRAPH_BLOCKED_NODE_MAJOR) {
    return { major, override, reason: "too-new", supported: override };
  }
  if (major < CODEGRAPH_MIN_NODE_MAJOR) {
    return { major, override, reason: "too-old", supported: override };
  }
  return { major, override, supported: true };
}
function buildCodegraphNodeSkipHint(support) {
  const detail = support.reason === "too-new" ? `Node ${support.major} is unsupported (>= ${CODEGRAPH_BLOCKED_NODE_MAJOR} crashes CodeGraph mid-indexing)` : `Node ${support.major} is too old (CodeGraph requires >= ${CODEGRAPH_MIN_NODE_MAJOR})`;
  return `CodeGraph MCP skipped: ${detail}. Use Node ${CODEGRAPH_MIN_NODE_MAJOR}-${CODEGRAPH_BLOCKED_NODE_MAJOR - 1} (e.g. Node 22 LTS) or set ${CODEGRAPH_UNSAFE_NODE_ENV}=1 to override.
`;
}
function parseNodeMajor(version2) {
  const normalized = version2.startsWith("v") ? version2.slice(1) : version2;
  const major = Number.parseInt(normalized.split(".")[0] ?? "", 10);
  return Number.isNaN(major) ? 0 : major;
}

// ../../utils/src/codegraph/provision.ts
import { createHash as createHash2, randomUUID as randomUUID4 } from "node:crypto";
import { execFile as execFile2 } from "node:child_process";
import { chmod, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { existsSync as existsSync9 } from "node:fs";
import { homedir as homedir9, hostname } from "node:os";
import { basename as basename4, join as join18 } from "node:path";
import { promisify } from "node:util";
var DEFAULT_LOCK_WAIT_MS = 5000;
var DEFAULT_LOCK_STALE_MS = 120000;
var DEFAULT_DOWNLOAD_TIMEOUT_MS = 60000;
var execFileAsync = promisify(execFile2);
function platformKey() {
  return `${process.platform}-${process.arch}`;
}
function markerPath(installDir, version2) {
  return join18(installDir, ".provisioned", `codegraph-${version2}.json`);
}
function defaultInstallDir() {
  return join18(homedir9(), ".omo", "codegraph");
}
function sha256(bytes) {
  return createHash2("sha256").update(bytes).digest("hex");
}
function isErrnoException(error) {
  return error instanceof Error && "code" in error;
}
async function removeEmptyDirectory(path) {
  try {
    await rmdir(path);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT")
      return;
    if (isErrnoException(error) && error.code === "ENOTEMPTY")
      return;
    throw error;
  }
}
function sleep(ms) {
  return new Promise((resolve9) => setTimeout(resolve9, ms));
}
async function defaultDownloader(asset, timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT_MS) {
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok)
    throw new Error(`download failed with HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
function forcedBadChecksumOptions(options) {
  if (options.forceBadChecksum !== true)
    return null;
  const key = options.platformKey ?? platformKey();
  return {
    downloader: async () => new TextEncoder().encode("checksum mismatch"),
    installDir: options.installDir ?? join18(options.lockDir, "codegraph-force-bad-checksum"),
    manifest: {
      assets: {
        [key]: { executableName: process.platform === "win32" ? "codegraph.cmd" : "codegraph", sha256: "0000", url: "memory://bad" }
      },
      version: options.version
    },
    platformKey: key
  };
}
async function readMarker(path, version2) {
  if (!existsSync9(path))
    return null;
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    if (typeof raw === "object" && raw !== null && "binPath" in raw && "version" in raw) {
      const binPath = raw.binPath;
      return raw.version === version2 && typeof binPath === "string" && existsSync9(binPath) ? binPath : null;
    }
    return null;
  } catch (error) {
    if (error instanceof Error)
      return null;
    throw error;
  }
}
async function acquireLock(lockPath, waitMs, staleMs) {
  const startedAt = Date.now();
  await mkdir(join18(lockPath, ".."), { recursive: true });
  while (Date.now() - startedAt <= waitMs) {
    try {
      await mkdir(lockPath);
      return () => rm(lockPath, { force: true, recursive: true });
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "EEXIST")
        throw error;
      const lockStat = await stat(lockPath).catch(() => null);
      if (lockStat !== null && Date.now() - lockStat.mtimeMs > staleMs) {
        await rm(lockPath, { force: true, recursive: true });
        continue;
      }
      await sleep(25);
    }
  }
  return null;
}
async function extractTarGz(archivePath, destinationDir) {
  await execFileAsync("tar", ["-xzf", archivePath, "-C", destinationDir]);
}
async function installExtractedBundle(extractDir, installDir, executableName) {
  const roots = await readdir(extractDir);
  if (roots.length !== 1)
    throw new Error(`CodeGraph archive should contain one root directory, found ${roots.length}`);
  const bundleDir = join18(extractDir, roots[0] ?? "");
  const bundleEntries = await readdir(bundleDir);
  await mkdir(installDir, { recursive: true });
  for (const entry of bundleEntries) {
    await rm(join18(installDir, entry), { force: true, recursive: true });
    await rename(join18(bundleDir, entry), join18(installDir, entry));
  }
  const destination = join18(installDir, "bin", executableName);
  if (!existsSync9(destination))
    throw new Error(`CodeGraph archive did not contain bin/${executableName}`);
  await chmod(destination, 493);
  return destination;
}
async function installAsset(layout) {
  const { asset, downloader, installDir, version: version2 } = layout;
  const stagingDir = join18(installDir, ".staging", randomUUID4());
  const archivePath = join18(stagingDir, basename4(asset.url));
  const extractDir = join18(stagingDir, "extract");
  try {
    await mkdir(extractDir, { recursive: true });
    const bytes = await downloader(asset);
    const actualChecksum = sha256(bytes);
    if (actualChecksum !== asset.sha256) {
      throw new Error(`checksum mismatch for ${basename4(asset.url)}: expected ${asset.sha256}, got ${actualChecksum}`);
    }
    if (!asset.url.endsWith(".tar.gz") && !asset.url.endsWith(".tgz")) {
      throw new Error(`unsupported CodeGraph archive type for ${basename4(asset.url)}`);
    }
    await writeFile(archivePath, bytes);
    await extractTarGz(archivePath, extractDir);
    const destination = await installExtractedBundle(extractDir, installDir, asset.executableName);
    await mkdir(join18(installDir, ".provisioned"), { recursive: true });
    await writeFile(markerPath(installDir, version2), `${JSON.stringify({ binPath: destination, version: version2 })}
`);
    return destination;
  } finally {
    await rm(stagingDir, { force: true, recursive: true });
    await removeEmptyDirectory(join18(installDir, ".staging"));
  }
}
async function ensureCodegraphProvisioned(options) {
  const forced = forcedBadChecksumOptions(options);
  const installDir = forced?.installDir ?? options.installDir ?? defaultInstallDir();
  const manifest = forced?.manifest ?? options.manifest ?? CODEGRAPH_PROVISION_MANIFEST;
  const activePlatformKey = forced?.platformKey ?? options.platformKey ?? platformKey();
  const downloader = forced?.downloader ?? options.downloader ?? ((asset) => defaultDownloader(asset, options.downloadTimeoutMs));
  const marker = markerPath(installDir, options.version);
  const existing = await readMarker(marker, options.version);
  if (existing !== null)
    return { binPath: existing, provisioned: true };
  const lockPath = join18(options.lockDir, `codegraph-${hostname()}.lock`);
  const release = await acquireLock(lockPath, options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS, options.lockStaleMs ?? DEFAULT_LOCK_STALE_MS);
  if (release === null)
    return { error: "timed out waiting for codegraph provisioning lock", provisioned: false };
  try {
    const lockedExisting = await readMarker(marker, options.version);
    if (lockedExisting !== null)
      return { binPath: lockedExisting, provisioned: true };
    if (manifest.version !== options.version) {
      return { error: `manifest version ${manifest.version} does not match requested ${options.version}`, provisioned: false };
    }
    const asset = manifest.assets[activePlatformKey];
    if (asset === undefined) {
      return { error: `no CodeGraph ${options.version} asset for ${activePlatformKey}`, provisioned: false };
    }
    const binPath = await installAsset({ asset, downloader, installDir, version: options.version });
    return { binPath, provisioned: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), provisioned: false };
  } finally {
    await release();
  }
}

// ../../utils/src/codegraph/resolve.ts
import { existsSync as existsSync10 } from "node:fs";
import { homedir as homedir10 } from "node:os";
import { spawnSync } from "node:child_process";
import { basename as basename5, dirname as dirname12, join as join20 } from "node:path";
import { createRequire } from "node:module";

// ../../utils/src/runtime/which.ts
import { accessSync, constants } from "node:fs";
import { delimiter, join as join19 } from "node:path";
var runtime = globalThis;
function isUnsafeCommandName(commandName) {
  if (commandName.includes("/") || commandName.includes("\\"))
    return true;
  if (commandName === "." || commandName === ".." || commandName.includes(".."))
    return true;
  if (/^[a-zA-Z]:/.test(commandName))
    return true;
  if (commandName.includes("\x00"))
    return true;
  return false;
}
function isExecutable(filePath) {
  try {
    accessSync(filePath, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return true;
  } catch (error) {
    if (!(error instanceof Error) && Object.prototype.toString.call(error) !== "[object Error]") {
      throw error;
    }
    return false;
  }
}
function resolvePathValue() {
  if (process.platform === "win32")
    return process.env["Path"] ?? process.env["PATH"];
  return process.env["PATH"];
}
function getWindowsCandidates(commandName) {
  if (process.platform !== "win32")
    return [commandName];
  if (/\.[^\\/]+$/.test(commandName))
    return [commandName];
  return [commandName, `${commandName}.exe`, `${commandName}.cmd`, `${commandName}.bat`, `${commandName}.com`];
}
function bunWhich(commandName) {
  if (!commandName)
    return null;
  if (isUnsafeCommandName(commandName))
    return null;
  const candidateNames = getWindowsCandidates(commandName);
  for (const candidateName of candidateNames) {
    const resolvedPath = runtime.Bun?.which(candidateName) ?? null;
    if (resolvedPath !== null)
      return resolvedPath;
  }
  const pathValue = resolvePathValue();
  if (!pathValue)
    return null;
  const pathEntries = pathValue.split(delimiter).filter((pathEntry) => pathEntry.length > 0);
  if (pathEntries.length === 0)
    return null;
  for (const pathEntry of pathEntries) {
    for (const candidateName of candidateNames) {
      const candidatePath = join19(pathEntry, candidateName);
      if (isExecutable(candidatePath))
        return candidatePath;
    }
  }
  return null;
}

// ../../utils/src/codegraph/resolve.ts
function codegraphCommandRequiresSupportedLocalNode(resolution) {
  return resolution.source !== "bundled" && resolution.source !== "env" && resolution.source !== "provisioned";
}
var CODEGRAPH_PACKAGE = "@colbymchenry/codegraph";
var CODEGRAPH_ENV_BIN = "OMO_CODEGRAPH_BIN";
var CODEGRAPH_LEGACY_ENV_BIN = "CODEGRAPH_BIN";
var CODEGRAPH_NODE_CANDIDATES = ["node24", "node22", "node20", "node"];
var CODEGRAPH_NODE_PATH_CANDIDATES = [
  "/opt/homebrew/opt/node@24/bin/node",
  "/opt/homebrew/opt/node@22/bin/node",
  "/opt/homebrew/opt/node@20/bin/node",
  "/usr/local/opt/node@24/bin/node",
  "/usr/local/opt/node@22/bin/node",
  "/usr/local/opt/node@20/bin/node"
];
var requireFromHere = createRequire(import.meta.url);
function defaultRequireResolve(specifier) {
  return requireFromHere.resolve(specifier);
}
function defaultNodeVersion(nodePath) {
  if (nodePath === process.execPath && isNodeExecutableName(nodePath))
    return process.versions.node;
  try {
    const result = spawnSync(nodePath, ["--version"], {
      encoding: "utf8",
      timeout: 2000,
      windowsHide: true
    });
    if (result.error !== undefined || result.status !== 0)
      return null;
    const version2 = `${result.stdout}
${result.stderr}`.trim().split(/\s+/)[0];
    return version2 === undefined || version2.length === 0 ? null : version2;
  } catch (error) {
    if (error instanceof Error)
      return null;
    throw error;
  }
}
function isNodeExecutableName(filePath) {
  const executable = basename5(filePath).toLowerCase();
  return executable === "node" || executable === "node.exe" || /^node\d+(\.exe)?$/.test(executable);
}
function looksLikePath(command) {
  return command.includes("/") || command.includes("\\") || /^[a-zA-Z]:/.test(command);
}
function resolveConfiguredNodeRuntime(configured, fileExists, which) {
  if (looksLikePath(configured))
    return fileExists(configured) ? configured : null;
  return which(configured);
}
function supportsCodegraphNodeRuntime(nodePath, env, nodeVersion) {
  const version2 = nodeVersion(nodePath);
  if (version2 === null)
    return false;
  return evaluateCodegraphNodeSupport({ env, nodeVersion: version2 }).supported;
}
function defaultNodeRuntime(env, fileExists, which, nodeVersion) {
  const configured = env[CODEGRAPH_NODE_BIN_ENV]?.trim();
  if (configured !== undefined && configured.length > 0) {
    const resolved = resolveConfiguredNodeRuntime(configured, fileExists, which);
    return resolved !== null && supportsCodegraphNodeRuntime(resolved, env, nodeVersion) ? resolved : null;
  }
  const candidates = [
    ...isNodeExecutableName(process.execPath) ? [process.execPath] : [],
    ...CODEGRAPH_NODE_CANDIDATES.map((commandName) => which(commandName)).filter((candidate) => candidate !== null),
    ...CODEGRAPH_NODE_PATH_CANDIDATES.filter((candidate) => fileExists(candidate))
  ];
  const seen = new Set;
  for (const candidate of candidates) {
    if (seen.has(candidate))
      continue;
    seen.add(candidate);
    if (supportsCodegraphNodeRuntime(candidate, env, nodeVersion))
      return candidate;
  }
  return null;
}
function defaultProvisionedBin(homeDir, fileExists) {
  return resolvePinnedCodegraphBin(join20(homeDir, ".omo", "codegraph"), { fileExists });
}
function resolveBundledShim(requireResolve, fileExists) {
  try {
    const packageJson = requireResolve(`${CODEGRAPH_PACKAGE}/package.json`);
    const packageRoot = dirname12(packageJson);
    const candidates = [join20(packageRoot, "bin", "codegraph.js"), join20(packageRoot, "npm-shim.js")];
    return candidates.find((candidate) => fileExists(candidate)) ?? null;
  } catch (error) {
    if (error instanceof Error)
      return null;
    if (error === null || error === undefined)
      return null;
    if (typeof error === "object" || typeof error === "string" || typeof error === "number")
      return null;
    if (typeof error === "boolean" || typeof error === "bigint" || typeof error === "symbol")
      return null;
    return null;
  }
}
function resolveCodegraphCommand(options = {}) {
  const env = options.env ?? process.env;
  const fileExists = options.fileExists ?? existsSync10;
  const configuredBin = env[CODEGRAPH_ENV_BIN]?.trim() || env[CODEGRAPH_LEGACY_ENV_BIN]?.trim();
  if (configuredBin !== undefined && configuredBin.length > 0) {
    return { argsPrefix: [], command: configuredBin, exists: fileExists(configuredBin), source: "env" };
  }
  const which = options.which ?? bunWhich;
  const nodeRuntime = options.nodeRuntime ?? (() => defaultNodeRuntime(env, fileExists, which, options.nodeVersion ?? defaultNodeVersion));
  const bundled = resolveBundledShim(options.requireResolve ?? defaultRequireResolve, fileExists);
  const runtime2 = nodeRuntime();
  if (bundled !== null && runtime2 !== null) {
    return { argsPrefix: [bundled], command: runtime2, exists: true, source: "bundled" };
  }
  const provisioned = options.provisioned?.() ?? defaultProvisionedBin(options.homeDir ?? homedir10(), fileExists);
  if (provisioned !== null && fileExists(provisioned)) {
    return { argsPrefix: [], command: provisioned, exists: true, source: "provisioned" };
  }
  const pathCommand = which("codegraph");
  return {
    argsPrefix: [],
    command: pathCommand ?? "codegraph",
    exists: pathCommand !== null,
    source: "path"
  };
}

// components/codegraph/src/session-start-command.ts
import { join as join21 } from "node:path";
import { env as processEnv, stderr as processStderr } from "node:process";

// ../../utils/src/process-tree.ts
import { spawn as spawn2 } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

// ../../utils/src/process-tree-termination.ts
import { execFile as execFile3 } from "node:child_process";
async function terminateProcessTree(pid, options) {
  return options.platform === "win32" ? terminateWindowsProcessTree(pid, options) : terminatePosixProcessTree(pid, options);
}
async function terminatePosixProcessTree(pid, options) {
  const attempts = [];
  const knownPids = new Set(await listPosixTreePids(pid));
  attempts.push(attemptPosixSignal(pid, "SIGTERM", "process-group"));
  await waitForDirectChild(options.childClosed, options.graceMs);
  for (const treePid of await listPosixTreePids(pid))
    knownPids.add(treePid);
  const gracefulSurvivors = [...knownPids].filter(isProcessAlive);
  if (gracefulSurvivors.length > 0) {
    attempts.push(attemptPosixSignal(pid, "SIGKILL", "process-group"));
    for (const survivorPid of gracefulSurvivors) {
      attempts.push(attemptPosixSignal(survivorPid, "SIGKILL", "process"));
    }
  }
  const [survivorPids] = await Promise.all([
    waitForSurvivors([...knownPids], options.waitMs),
    waitForDirectChild(options.childClosed, options.waitMs)
  ]);
  return { attempts, survivorPids };
}
async function terminateWindowsProcessTree(pid, options) {
  const attempts = [];
  attempts.push(await attemptWindowsTreeSignal(pid, "SIGTERM"));
  await waitForDirectChild(options.childClosed, options.graceMs);
  if (isProcessAlive(pid))
    attempts.push(await attemptWindowsTreeSignal(pid, "SIGKILL"));
  const [survivorPids] = await Promise.all([
    waitForSurvivors([pid], options.waitMs),
    waitForDirectChild(options.childClosed, options.waitMs)
  ]);
  return { attempts, survivorPids };
}
function attemptPosixSignal(pid, signal, target) {
  try {
    process.kill(target === "process-group" ? -pid : pid, signal);
    return { outcome: "sent", pid, signal, target };
  } catch (error) {
    if (!(error instanceof Error))
      throw error;
    const code = "code" in error ? error.code : undefined;
    if (code === "ESRCH")
      return { outcome: "missing", pid, signal, target };
    if (code === "EPERM")
      return { error: error.message, outcome: "denied", pid, signal, target };
    return { error: error.message, outcome: "failed", pid, signal, target };
  }
}
function attemptWindowsTreeSignal(pid, signal) {
  const args = ["/PID", String(pid), "/T", ...signal === "SIGKILL" ? ["/F"] : []];
  return new Promise((resolvePromise) => {
    execFile3("taskkill.exe", args, { timeout: 5000, windowsHide: true }, (error) => {
      if (error === null) {
        resolvePromise({ outcome: "sent", pid, signal, target: "process-tree" });
        return;
      }
      const code = "code" in error ? error.code : undefined;
      const outcome = code === "EPERM" ? "denied" : code === "ESRCH" ? "missing" : "failed";
      resolvePromise({ error: error.message, outcome, pid, signal, target: "process-tree" });
    });
  });
}
async function listPosixTreePids(rootPid) {
  try {
    const rows = parseProcessRows(await execFileText2("ps", ["-eo", "pid=,ppid=,pgid="]));
    const selected = new Set([rootPid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) {
        if (selected.has(row.pid) || row.pgid !== rootPid && !selected.has(row.ppid))
          continue;
        selected.add(row.pid);
        changed = true;
      }
    }
    return [...selected];
  } catch (error) {
    if (error instanceof Error)
      return [rootPid];
    throw error;
  }
}
function parseProcessRows(output) {
  const rows = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    const pidText = match?.[1];
    const ppidText = match?.[2];
    const pgidText = match?.[3];
    if (pidText === undefined || ppidText === undefined || pgidText === undefined)
      continue;
    const pid = Number(pidText);
    const ppid = Number(ppidText);
    const pgid = Number(pgidText);
    if (![pid, ppid, pgid].every(Number.isSafeInteger))
      continue;
    rows.push({ pgid, pid, ppid });
  }
  return rows;
}
function execFileText2(command, args) {
  return new Promise((resolvePromise, reject) => {
    execFile3(command, [...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolvePromise(stdout);
    });
  });
}
async function waitForSurvivors(pids, waitMs) {
  const deadline = Date.now() + waitMs;
  let survivors = pids.filter(isProcessAlive);
  while (survivors.length > 0 && Date.now() < deadline) {
    await delay2(Math.min(25, Math.max(0, deadline - Date.now())));
    survivors = survivors.filter(isProcessAlive);
  }
  return survivors;
}
function waitForDirectChild(childClosed, waitMs) {
  return Promise.race([childClosed, delay2(waitMs)]);
}
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (!(error instanceof Error))
      throw error;
    const code = "code" in error ? error.code : undefined;
    if (code === "ESRCH")
      return false;
    return code === "EPERM";
  }
}
function delay2(ms) {
  if (ms <= 0)
    return Promise.resolve();
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

// ../../utils/src/process-tree.ts
var DEFAULT_TERMINATION_GRACE_MS = 1000;
var DEFAULT_TERMINATION_WAIT_MS = 2000;
function runProcessWithTreeTimeout(options) {
  return new Promise((resolvePromise) => {
    const child = spawn2(options.command, [...options.args], {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    let stderrBytes = 0;
    let stdout = "";
    let stdoutBytes = 0;
    let timedOut = false;
    let overflowed = false;
    let settled = false;
    let treeTermination;
    let resolveChildClosed = () => {
      return;
    };
    const childClosed = new Promise((resolveClosed) => {
      resolveChildClosed = resolveClosed;
    });
    const stderrDecoder = new StringDecoder("utf8");
    const stdoutDecoder = new StringDecoder("utf8");
    const startTermination = () => {
      if (treeTermination !== undefined)
        return treeTermination;
      treeTermination = child.pid === undefined ? Promise.resolve({ attempts: [], survivorPids: [] }) : terminateProcessTree(child.pid, {
        childClosed,
        graceMs: options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS,
        platform: process.platform,
        waitMs: options.terminationWaitMs ?? DEFAULT_TERMINATION_WAIT_MS
      });
      treeTermination = treeTermination.then((report) => {
        try {
          options.onTerminationReport?.(report);
        } catch (error) {
          stderr += `[process-tree] termination observer failed: ${error instanceof Error ? error.message : String(error)}
`;
        }
        return report;
      });
      return treeTermination;
    };
    const capture = (target, chunk) => {
      if (overflowed)
        return;
      const currentBytes = target === "stdout" ? stdoutBytes : stderrBytes;
      if (currentBytes + chunk.length > options.maxBuffer) {
        overflowed = true;
        startTermination().then(() => settle(1, null));
        return;
      }
      if (target === "stdout") {
        stdoutBytes += chunk.length;
        stdout += stdoutDecoder.write(chunk);
      } else {
        stderrBytes += chunk.length;
        stderr += stderrDecoder.write(chunk);
      }
    };
    child.stdout.on("data", (chunk) => capture("stdout", chunk));
    child.stderr.on("data", (chunk) => capture("stderr", chunk));
    let removeTimeoutSignal = () => {
      return;
    };
    let timeout;
    const settle = async (exitCode, signal) => {
      if (settled)
        return;
      settled = true;
      clearTimeout(timeout);
      removeTimeoutSignal();
      const termination = treeTermination === undefined ? null : await treeTermination;
      stderr += stderrDecoder.end();
      stdout += stdoutDecoder.end();
      resolvePromise({ exitCode, signal, stderr, stdout, termination, timedOut });
    };
    const triggerTimeout = () => {
      if (settled)
        return;
      timedOut = true;
      startTermination().then(() => settle(124, child.signalCode));
    };
    timeout = setTimeout(triggerTimeout, options.timeoutMs);
    timeout.unref();
    if (options.timeoutSignal?.aborted === true) {
      triggerTimeout();
    } else if (options.timeoutSignal !== undefined) {
      const timeoutSignal = options.timeoutSignal;
      timeoutSignal.addEventListener("abort", triggerTimeout, { once: true });
      removeTimeoutSignal = () => timeoutSignal.removeEventListener("abort", triggerTimeout);
    }
    child.once("error", () => {
      resolveChildClosed();
      settle(1, null);
    });
    child.once("close", (code, signal) => {
      resolveChildClosed();
      settle(timedOut ? 124 : overflowed ? 1 : code ?? 1, signal);
    });
  });
}

// components/codegraph/src/serve-invocation.ts
import { extname } from "node:path";
import { execPath as processExecPath } from "node:process";
var WINDOWS_CMD_EXTENSIONS = new Set([".bat", ".cmd"]);
var WINDOWS_NODE_SCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"]);
function resolveServeProcessInvocation(command, args, platform = process.platform) {
  if (platform !== "win32")
    return { args: [...args], command };
  const extension = extname(command).toLowerCase();
  if (WINDOWS_NODE_SCRIPT_EXTENSIONS.has(extension)) {
    return { args: [command, ...args], command: processExecPath };
  }
  if (WINDOWS_CMD_EXTENSIONS.has(extension)) {
    return { args: ["/d", "/s", "/c", command, ...args], command: "cmd.exe" };
  }
  return { args: [...args], command };
}

// components/codegraph/src/session-start-command.ts
var SESSION_START_COMMAND_TIMEOUT_MS = 60000;
async function resolveSessionStartCommand(options) {
  const trustedInstallDir = options.config.trustedCodegraphInstallDir;
  const installDir = trustedInstallDir ?? join21(options.homeDir, ".omo", "codegraph");
  const resolved = options.deps.resolveCommand({
    env: options.env,
    homeDir: options.homeDir,
    provisioned: () => options.deps.resolveManagedBin(installDir)
  });
  const managedBin = options.deps.resolveManagedBin(installDir);
  if (resolved.source !== "env" && managedBin !== null) {
    return { kind: "resolved", resolution: { argsPrefix: [], command: managedBin, exists: true, source: "provisioned" } };
  }
  if (resolved.source !== "env" && options.config.auto_provision !== false && options.deps.managedInstallExists(installDir)) {
    const upgraded = await options.deps.ensureProvisioned({
      installDir,
      lockDir: join21(installDir, ".locks"),
      version: CODEGRAPH_PINNED_VERSION
    });
    if (upgraded.provisioned && upgraded.binPath !== undefined) {
      return { kind: "resolved", resolution: { argsPrefix: [], command: upgraded.binPath, exists: true, source: "provisioned" } };
    }
  }
  if (resolved.exists && canUseResolvedCommand(resolved, options.nodeSupport)) {
    return { kind: "resolved", resolution: resolved };
  }
  if (resolved.exists && options.config.auto_provision === false)
    return { kind: "unsupported-node" };
  if (options.config.auto_provision === false) {
    return { error: "codegraph binary unavailable and auto_provision is disabled", kind: "unavailable", source: resolved.source };
  }
  const provisioned = await options.deps.ensureProvisioned({
    installDir,
    lockDir: join21(installDir, ".locks"),
    version: CODEGRAPH_PINNED_VERSION
  });
  if (!provisioned.provisioned || provisioned.binPath === undefined) {
    return { error: provisioned.error ?? "provisioning did not produce a binary", kind: "unavailable", source: resolved.source };
  }
  return { kind: "resolved", resolution: { argsPrefix: [], command: provisioned.binPath, exists: true, source: "provisioned" } };
}
function sessionStartCodegraphEnv(config2, homeDir) {
  const env = buildCodegraphEnv({ daemon: false, homeDir });
  return config2.trustedCodegraphInstallDir === undefined ? env : { ...env, CODEGRAPH_INSTALL_DIR: config2.trustedCodegraphInstallDir };
}
async function runSessionStartCodegraphCommand(projectRoot, command, args, options) {
  const invocation = resolveCodegraphCommandInvocation(command, args);
  return runProcessWithTreeTimeout({
    args: invocation.args,
    command: invocation.command,
    cwd: projectRoot,
    env: buildCodegraphChildEnv({ ambientEnv: processEnv, codegraphEnv: options.env }),
    maxBuffer: 1024 * 1024,
    onTerminationReport: (report) => processStderr.write(`[codegraph-session-start] process tree termination ${JSON.stringify(report)}
`),
    timeoutMs: options.timeoutMs
  }).then(({ exitCode, stderr, stdout, timedOut }) => ({ exitCode, stderr, stdout, timedOut }));
}
function resolveCodegraphCommandInvocation(command, args, platform = process.platform) {
  return resolveServeProcessInvocation(command, args, platform);
}
function canUseResolvedCommand(resolved, nodeSupport) {
  return !codegraphCommandRequiresSupportedLocalNode(resolved) || nodeSupport.supported;
}

// components/codegraph/src/session-start-worker-result.ts
import { env as processEnv2, stderr as processStderr2 } from "node:process";
function finishWorkerProjectState(state, context) {
  switch (state.kind) {
    case "inconclusive":
      return finishWorkerFailure("skipped-probe-error", "skipped-probe-error", {
        error: state.reason,
        projectRoot: context.projectRoot
      }, context);
    case "initialized":
      return finishWorkerSuccess("skipped-initialized", { projectRoot: context.projectRoot }, context);
    case "nested-root":
      return finishWorkerSuccess("skipped-nested-root", {
        ancestorRoot: state.ancestorRoot,
        projectRoot: context.projectRoot
      }, context);
    case "uninitialized":
      return null;
  }
}
function finishWorkerInitialization(state, detail, context) {
  switch (state.kind) {
    case "inconclusive":
      return finishWorkerFailure("skipped-probe-error", "skipped-probe-error", {
        error: state.reason,
        ...detail,
        projectRoot: context.projectRoot,
        timedOut: false
      }, context);
    case "initialized":
      return finishWorkerSuccess("initialized", {
        ...detail,
        projectRoot: context.projectRoot,
        timedOut: false
      }, context);
    case "nested-root":
      return finishWorkerFailure("failed", "failed", {
        ...detail,
        error: `codegraph init resolved to ancestor database at ${state.ancestorRoot}`,
        projectRoot: context.projectRoot,
        timedOut: false
      }, context);
    case "uninitialized":
      return finishWorkerFailure("failed", "failed", {
        ...detail,
        error: "codegraph init completed without creating an exact project database",
        projectRoot: context.projectRoot,
        timedOut: false
      }, context);
  }
}
function finishWorkerFailure(action, failureAction, detail, context) {
  let releaseLock = true;
  try {
    recordSessionStartFailure({
      action: failureAction,
      baseCooldownMs: context.baseCooldownMs,
      homeDir: context.homeDir,
      nowMs: context.nowMs(),
      projectRoot: context.projectRoot
    });
  } catch (error) {
    if (error instanceof Error)
      releaseLock = false;
    else
      throw error;
  }
  safeLogWorkerOutcome(context.logOutcome, { ...detail, action });
  return { action, releaseLock };
}
function finishWorkerSuccess(action, detail, context) {
  try {
    clearSessionStartCooldown({ homeDir: context.homeDir, projectRoot: context.projectRoot });
  } catch (error) {
    if (error instanceof Error)
      writeDebugLog(`failed to clear SessionStart cooldown: ${error.message}`);
    else
      throw error;
  }
  safeLogWorkerOutcome(context.logOutcome, { ...detail, action });
  return { action, releaseLock: true };
}
function finishWorkerNeutral(action, detail, context) {
  safeLogWorkerOutcome(context.logOutcome, { ...detail, action });
  return { action, releaseLock: true };
}
function safeLogWorkerOutcome(logOutcome, outcome) {
  try {
    logOutcome(outcome);
  } catch (error) {
    if (error instanceof Error)
      processStderr2.write(`[codegraph-session-start] failed to write outcome: ${error.message}
`);
    else
      throw error;
  }
}
function writeDebugLog(message) {
  if (processEnv2["OMO_CODEGRAPH_DEBUG"] !== "1")
    return;
  processStderr2.write(`[codegraph-session-start] ${message}
`);
}

// components/codegraph/src/session-start-worker.ts
var SESSION_START_CWD_ENV = "OMO_CODEGRAPH_SESSION_START_CWD";
var SESSION_START_LOCK_TOKEN_ENV = "OMO_CODEGRAPH_SESSION_START_LOCK_TOKEN";
var defaultDeps = {
  ensureGitignored: ensureCodegraphGitignored,
  ensureProvisioned: ensureCodegraphProvisioned,
  managedInstallExists: hasCodegraphManagedInstall,
  prepareWorkspace: prepareCodegraphWorkspace,
  resolveCommand: resolveCodegraphCommand,
  resolveManagedBin: resolvePinnedCodegraphBin,
  runCommand: runSessionStartCodegraphCommand
};
async function runCodegraphSessionStartWorker(options = {}) {
  const env = options.env ?? processEnv3;
  const homeDir = resolveHomeDir4(env);
  const projectRoot = options.cwd ?? env[SESSION_START_CWD_ENV] ?? processCwd();
  const config2 = options.config ?? getCodexOmoConfig({ cwd: projectRoot, env, homeDir });
  const lock = resolveWorkerLock(homeDir, projectRoot, env[SESSION_START_LOCK_TOKEN_ENV]);
  if (lock !== null && !sessionStartLockIsOwned(lock)) {
    const outcome = { action: "skipped-locked", projectRoot };
    safeLogWorkerOutcome(options.logOutcome ?? ((value) => appendSessionStartOutcome(homeDir, value)), outcome);
    return { action: "skipped-locked" };
  }
  const customResolutionDeps = options.deps?.resolveCommand === undefined ? {} : {
    managedInstallExists: options.deps.managedInstallExists ?? (() => false),
    resolveManagedBin: options.deps.resolveManagedBin ?? (() => null)
  };
  const context = {
    baseCooldownMs: config2.codegraph?.session_start_cooldown_ms ?? DEFAULT_SESSION_START_COOLDOWN_MS,
    config: {
      ...config2.codegraph ?? {},
      ...config2.trustedCodegraphInstallDir === undefined ? {} : { trustedCodegraphInstallDir: config2.trustedCodegraphInstallDir }
    },
    deps: { ...defaultDeps, ...customResolutionDeps, ...options.deps },
    env,
    homeDir,
    logOutcome: options.logOutcome ?? ((outcome) => appendSessionStartOutcome(homeDir, outcome)),
    nowMs: () => options.nowMs ?? Date.now(),
    probeProject: options.projectProbe ?? probeCodegraphProject,
    projectRoot
  };
  let result;
  if (config2.codegraph?.enabled === false) {
    result = finishWorkerNeutral("skipped-disabled", { projectRoot }, context);
  } else {
    const nodeSupport = evaluateCodegraphNodeSupport({ env, nodeVersion: options.nodeVersion });
    result = await runBootstrap(context, nodeSupport);
  }
  if (lock !== null && result.releaseLock)
    releaseSessionStartLock(lock);
  return { action: result.action };
}
async function runBootstrap(context, nodeSupport) {
  try {
    const projectState = context.probeProject(context.projectRoot);
    const projectDecision = finishWorkerProjectState(projectState, context);
    if (projectDecision !== null)
      return projectDecision;
    const command = await resolveSessionStartCommand({
      config: context.config,
      deps: context.deps,
      env: context.env,
      homeDir: context.homeDir,
      nodeSupport
    });
    if (command.kind === "unavailable") {
      return finishWorkerFailure("skipped-unavailable", "skipped-unavailable", {
        error: command.error,
        projectRoot: context.projectRoot,
        source: command.source
      }, context);
    }
    if (command.kind === "unsupported-node") {
      return finishWorkerFailure("skipped-unsupported-node", "skipped-unsupported-node", { projectRoot: context.projectRoot }, context);
    }
    context.deps.prepareWorkspace(context.projectRoot, { homeDir: context.homeDir });
    context.deps.ensureGitignored(context.projectRoot);
    const preparedState = context.probeProject(context.projectRoot);
    const preparedDecision = finishWorkerProjectState(preparedState, context);
    if (preparedDecision !== null)
      return preparedDecision;
    const action = await context.deps.runCommand(context.projectRoot, command.resolution.command, [...command.resolution.argsPrefix, "init"], { env: sessionStartCodegraphEnv(context.config, context.homeDir), timeoutMs: SESSION_START_COMMAND_TIMEOUT_MS });
    if (action.timedOut) {
      return finishWorkerFailure("failed", "timeout", {
        error: "codegraph init timed out",
        exitCode: action.exitCode,
        projectRoot: context.projectRoot,
        source: command.resolution.source,
        timedOut: true
      }, context);
    }
    if (action.exitCode !== 0) {
      return finishWorkerFailure("failed", "failed", {
        error: `codegraph init exited ${action.exitCode}`,
        exitCode: action.exitCode,
        projectRoot: context.projectRoot,
        source: command.resolution.source,
        timedOut: false
      }, context);
    }
    return finishWorkerInitialization(context.probeProject(context.projectRoot), {
      exitCode: action.exitCode,
      source: command.resolution.source
    }, context);
  } catch (error) {
    return finishWorkerFailure("failed", "failed", {
      error: error instanceof Error ? error.message : String(error),
      projectRoot: context.projectRoot
    }, context);
  }
}
function resolveWorkerLock(homeDir, projectRoot, token) {
  if (token === undefined || token.length === 0)
    return null;
  return { path: resolveSessionStartStatePaths(homeDir, projectRoot).lockPath, token };
}
function resolveHomeDir4(env) {
  return env["HOME"] ?? env["USERPROFILE"] ?? homedir11();
}

// components/codegraph/src/post-tool-use-hook.ts
import { env as processEnv4, stdin as processStdin, stdout as processStdout } from "node:process";

// ../../utils/src/codegraph/guidance.ts
import { homedir as homedir12 } from "node:os";
var CODEGRAPH_UNINITIALIZED_PATTERN = /CodeGraph not initialized in ([\s\S]*?)\.\s*Run ['`]codegraph init['`] in that project first\./i;
var ANSI_ESCAPE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
var CODEGRAPH_STATUS_PROJECT_PATTERN = /^.*?\bProject:\s*(.+?)\s*$/im;
var CODEGRAPH_STATUS_UNINITIALIZED_PATTERN = /^.*?\bNot initialized\s*$/im;
var CODEGRAPH_INIT_HINT_PATTERN = /Run\s+["'`]codegraph init["'`]\s+(?:in that project first|to initialize)\.?/i;
var CODEGRAPH_PROJECT_NOT_INDEXED_PATTERN = /The project at (.+?) isn't indexed with codegraph\b/i;
var CODEGRAPH_NO_PROJECT_LOADED_PATTERN = /No CodeGraph project is loaded for this session\./i;
var CODEGRAPH_NO_PROJECT_SEARCHED_FROM_PATTERN = /^Searched for a \.codegraph\/ directory starting from:\s*(.+?)\s*$/im;
function getCodegraphUninitializedProject(input) {
  const output = textFromUnknown(input.toolOutput);
  if (!isCodegraphTool(input.toolName))
    return null;
  const projectPath = extractProjectPath(output);
  if (projectPath !== null)
    return projectPath;
  if (!looksLikeCodegraphUninitializedOutput(output))
    return null;
  return typeof input.cwd === "string" && input.cwd.trim().length > 0 ? input.cwd.trim() : null;
}
function buildCodegraphInitGuidance(projectPath, options = {}) {
  const { dataDir, dataRoot, projectLink } = resolveCodegraphWorkspacePaths(projectPath, {
    homeDir: options.homeDir ?? homedir12()
  });
  const displayProjectPath = formatDisplayPath(projectPath);
  const displayProjectLink = formatDisplayPath(projectLink);
  const displayDataDir = formatDisplayPath(dataDir);
  const displayDataRoot = formatDisplayPath(dataRoot);
  return [
    "OMO CodeGraph initialization guidance:",
    "",
    `CodeGraph is not initialized for ${displayProjectPath}. Initialize it through OMO's global local store instead of leaving a standalone project-local index.`,
    "",
    `- Link or create ${displayProjectLink} so it points at ${displayDataDir} under the OMO store ${displayDataRoot}.`,
    `- Then run \`codegraph init\` from ${displayProjectPath} and retry the CodeGraph tool.`,
    "- OMO's CodeGraph bootstrap does this automatically on session start; if bootstrap just ran, wait for it to finish and retry."
  ].join(`
`);
}
function buildCodegraphInitGuidanceForToolResult(input, options = {}) {
  const projectPath = getCodegraphUninitializedProject(input);
  return projectPath === null ? null : buildCodegraphInitGuidance(projectPath, options);
}
function extractProjectPath(output) {
  const normalizedOutput = normalizeCodegraphOutput(output);
  const uninitializedMatch = normalizedOutput.match(CODEGRAPH_UNINITIALIZED_PATTERN);
  const uninitializedProject = uninitializedMatch?.[1]?.trim();
  if (uninitializedProject && uninitializedProject.length > 0)
    return uninitializedProject;
  const notIndexedMatch = normalizedOutput.match(CODEGRAPH_PROJECT_NOT_INDEXED_PATTERN);
  const notIndexedProject = notIndexedMatch?.[1]?.trim();
  if (notIndexedProject && notIndexedProject.length > 0)
    return notIndexedProject;
  if (CODEGRAPH_NO_PROJECT_LOADED_PATTERN.test(normalizedOutput)) {
    const searchedFromMatch = normalizedOutput.match(CODEGRAPH_NO_PROJECT_SEARCHED_FROM_PATTERN);
    const searchedFromProject = searchedFromMatch?.[1]?.trim();
    if (searchedFromProject && searchedFromProject.length > 0)
      return searchedFromProject;
  }
  if (!looksLikeCodegraphUninitializedOutput(normalizedOutput))
    return null;
  const statusMatch = normalizedOutput.match(CODEGRAPH_STATUS_PROJECT_PATTERN);
  const statusProject = statusMatch?.[1]?.trim();
  return statusProject && statusProject.length > 0 ? statusProject : null;
}
function looksLikeCodegraphUninitializedOutput(output) {
  const normalizedOutput = normalizeCodegraphOutput(output);
  if (normalizedOutput.match(CODEGRAPH_UNINITIALIZED_PATTERN) !== null)
    return true;
  return CODEGRAPH_STATUS_UNINITIALIZED_PATTERN.test(normalizedOutput) && CODEGRAPH_INIT_HINT_PATTERN.test(normalizedOutput);
}
function normalizeCodegraphOutput(output) {
  return output.replace(ANSI_ESCAPE_PATTERN, "");
}
function isCodegraphTool(toolName) {
  if (typeof toolName !== "string")
    return false;
  return toolName.startsWith("codegraph.") || toolName.startsWith("codegraph_") || toolName.startsWith("mcp__codegraph__");
}
function formatDisplayPath(value) {
  return JSON.stringify(value);
}
function textFromUnknown(value) {
  if (typeof value === "string")
    return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
    return String(value);
  if (Array.isArray(value))
    return value.map(textFromUnknown).filter(Boolean).join(`
`);
  if (!isRecord8(value))
    return "";
  return Object.entries(value).map(([key, nested]) => `${key}: ${textFromUnknown(nested)}`).filter((line) => line.trim().length > 0).join(`
`);
}
function isRecord8(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// components/codegraph/src/post-tool-use-hook.ts
async function runCodegraphPostToolUseHookCli(options = {}) {
  return (await executeCodegraphPostToolUseHook(options)).exitCode;
}
async function executeCodegraphPostToolUseHook(options = {}) {
  const env = options.env ?? processEnv4;
  const input = await readHookInput(options.stdin ?? processStdin);
  const output = runCodegraphPostToolUseHook(input, { homeDir: resolveHomeDir3(env) });
  if (output.length === 0)
    return { action: "skipped", exitCode: 0 };
  (options.stdout ?? processStdout).write(output);
  return { action: "emitted-guidance", exitCode: 0 };
}
function runCodegraphPostToolUseHook(input, options = {}) {
  const toolName = isRecord6(input) ? input["tool_name"] : undefined;
  const cwd = isRecord6(input) ? input["cwd"] : undefined;
  const toolOutput = isRecord6(input) ? input["tool_response"] ?? input["tool_output"] ?? input["response"] : input;
  const guidance = buildCodegraphInitGuidanceForToolResult({ cwd, toolName, toolOutput }, options);
  if (guidance === null)
    return "";
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: guidance
    }
  })}
`;
}

// components/codegraph/src/hook.ts
var CODEGRAPH_SESSION_START_NOTICE = "LazyCodex CodeGraph bootstrap scheduled in background";
var DEFAULT_SESSION_START_LOCK_STALE_MS = 10 * 60 * 1000;
async function runCodegraphSessionStartHook(options = {}) {
  return (await executeCodegraphSessionStartHook(options)).exitCode;
}
async function executeCodegraphSessionStartHook(options = {}) {
  const env = options.env ?? processEnv5;
  const input = await readHookInput(options.stdin ?? processStdin2);
  const projectRoot = resolveHookProjectRoot(input, options.cwd ?? processCwd2());
  const homeDir = resolveHomeDir3(env);
  const config2 = options.config ?? getCodexOmoConfig({ cwd: projectRoot, env, homeDir });
  if (config2.codegraph?.enabled === false)
    return { action: "skipped-disabled", exitCode: 0 };
  const excludedRoots = config2.codegraph?.excluded_roots;
  const exclusion = shouldExcludeCodegraphProject(projectRoot, {
    homeDir,
    ...excludedRoots === undefined ? {} : { excludedRoots }
  });
  if (exclusion.excluded)
    return { action: "skipped-excluded", exitCode: 0 };
  pruneCodegraphProjectStoresBestEffort(homeDir, { debugLog: writeDebugLog2 });
  await sweepCodegraphZombiesBestEffort({
    env,
    homeDir,
    ...config2.trustedCodegraphInstallDir === undefined ? {} : { trustedCodegraphInstallDir: config2.trustedCodegraphInstallDir },
    log: writeDebugLog2
  }, options.sweepZombies);
  const nowMs = options.nowMs ?? Date.now();
  const context = {
    baseCooldownMs: config2.codegraph?.session_start_cooldown_ms ?? DEFAULT_SESSION_START_COOLDOWN_MS,
    env,
    homeDir,
    logOutcome: options.logOutcome ?? ((outcome) => appendSessionStartOutcome(homeDir, outcome, nowMs)),
    nowMs,
    options,
    projectRoot
  };
  const projectDecision = handleProjectState(resolveHookProjectState(context), context);
  if (projectDecision !== null)
    return projectDecision;
  const cooldown = readSessionStartCooldown({
    baseCooldownMs: context.baseCooldownMs,
    homeDir,
    nowMs,
    projectRoot
  });
  if (cooldown.kind === "inconclusive")
    return { action: "skipped-inconclusive", exitCode: 0 };
  if (cooldown.kind === "active") {
    safeLogOutcome(context.logOutcome, {
      action: "skipped-cooldown",
      cooldownUntil: cooldown.cooldownUntil,
      failureCount: cooldown.failureCount,
      projectRoot
    });
    return { action: "skipped-cooldown", exitCode: 0 };
  }
  const lockResult = acquireSessionStartLock({
    homeDir,
    nowMs,
    projectRoot,
    staleMs: options.lockStaleMs ?? DEFAULT_SESSION_START_LOCK_STALE_MS
  });
  if (lockResult.kind === "inconclusive")
    return { action: "skipped-inconclusive", exitCode: 0 };
  if (lockResult.kind === "locked") {
    safeLogOutcome(context.logOutcome, { action: "skipped-locked", projectRoot });
    return { action: "skipped-locked", exitCode: 0 };
  }
  if (lockResult.recoveredStale)
    return handleRecoveredStaleLock(lockResult.lock, context);
  const lockedProjectDecision = handleProjectState(resolveHookProjectState(context), context);
  if (lockedProjectDecision !== null) {
    releaseSessionStartLock(lockResult.lock);
    return lockedProjectDecision;
  }
  try {
    (options.spawnWorker ?? spawnDetachedSessionStartWorker)({
      args: [options.workerCliPath ?? defaultWorkerCliPath(), "hook", "session-start-worker"],
      command: process.execPath,
      env: buildCodegraphChildEnv({
        ambientEnv: env,
        codegraphEnv: {
          [SESSION_START_CWD_ENV]: projectRoot,
          [SESSION_START_LOCK_TOKEN_ENV]: lockResult.lock.token
        },
        runtimeEnv: env
      })
    });
  } catch (error) {
    if (error instanceof Error)
      return handleSpawnFailure(error, lockResult.lock, context);
    throw error;
  }
  writeSessionStartNotice(options.stdout ?? processStdout2, CODEGRAPH_SESSION_START_NOTICE);
  return { action: "spawned", exitCode: 0 };
}
function resolveHookProjectState(context) {
  const exact = probeExactCodegraphProject(context.projectRoot);
  if (exact.kind !== "uninitialized")
    return exact;
  return (context.options.ancestorProbe ?? probeCodegraphAncestors)(context.projectRoot);
}
function handleProjectState(state, context) {
  switch (state.kind) {
    case "inconclusive":
      return { action: "skipped-inconclusive", exitCode: 0 };
    case "initialized":
      return { action: "skipped-initialized", exitCode: 0 };
    case "nested-root":
      safeLogOutcome(context.logOutcome, { action: "skipped-nested-root", ancestorRoot: state.ancestorRoot, projectRoot: context.projectRoot });
      return { action: "skipped-nested-root", exitCode: 0 };
    case "uninitialized":
      return null;
  }
}
function handleRecoveredStaleLock(lock, context) {
  try {
    const cooldown = recordSessionStartFailure({
      action: "stale-lock",
      baseCooldownMs: context.baseCooldownMs,
      homeDir: context.homeDir,
      nowMs: context.nowMs,
      projectRoot: context.projectRoot
    });
    releaseSessionStartLock(lock);
    safeLogOutcome(context.logOutcome, {
      action: "skipped-cooldown",
      cooldownUntil: cooldown.cooldownUntil,
      error: "recovered stale SessionStart worker lock",
      failureCount: cooldown.failureCount,
      projectRoot: context.projectRoot
    });
    return { action: "skipped-cooldown", exitCode: 0 };
  } catch (error) {
    if (error instanceof Error)
      return { action: "skipped-inconclusive", exitCode: 0 };
    throw error;
  }
}
function handleSpawnFailure(error, lock, context) {
  try {
    const cooldown = recordSessionStartFailure({
      action: "spawn-failed",
      baseCooldownMs: context.baseCooldownMs,
      homeDir: context.homeDir,
      nowMs: context.nowMs,
      projectRoot: context.projectRoot
    });
    releaseSessionStartLock(lock);
    safeLogOutcome(context.logOutcome, {
      action: "skipped-spawn-error",
      cooldownUntil: cooldown.cooldownUntil,
      error: error instanceof Error ? error.message : String(error),
      failureCount: cooldown.failureCount,
      projectRoot: context.projectRoot
    });
  } catch (cooldownError) {
    if (cooldownError instanceof Error)
      return { action: "skipped-inconclusive", exitCode: 0 };
    throw cooldownError;
  }
  return { action: "skipped-spawn-error", exitCode: 0 };
}
function safeLogOutcome(logOutcome, outcome) {
  try {
    logOutcome(outcome);
  } catch (error) {
    if (error instanceof Error)
      writeDebugLog2(`failed to write SessionStart outcome: ${error.message}`);
    else
      throw error;
  }
}
function writeDebugLog2(message) {
  if (processEnv5["OMO_CODEGRAPH_DEBUG"] !== "1")
    return;
  processStderr3.write(`${message}
`);
}
function defaultWorkerCliPath() {
  return fileURLToPath2(import.meta.url);
}

// components/codegraph/src/serve.ts
import { existsSync as existsSync11, realpathSync as realpathSync8 } from "node:fs";
import { homedir as homedir13 } from "node:os";
import { basename as basename6, join as join22, resolve as resolve9 } from "node:path";
import {
  cwd as processCwd3,
  env as processEnv6,
  stdin as processStdin3,
  stderr as processStderr4,
  stdout as processStdout3
} from "node:process";
import { fileURLToPath as fileURLToPath3 } from "node:url";

// components/codegraph/src/mcp-bridge.ts
import { spawn as spawn3 } from "node:child_process";

// ../../mcp-stdio-core/src/record.ts
function isPlainRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
// ../../mcp-stdio-core/src/responses.ts
function successResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function errorResponse(id, code, message, data) {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}
function jsonRpcId(value) {
  return typeof value === "string" || typeof value === "number" || value === null ? value : null;
}
function messageFromError(error) {
  return error instanceof Error ? error.message : String(error);
}
// ../../mcp-stdio-core/src/transport.ts
var HEADER_SEPARATOR = Buffer.from(`\r
\r
`);
async function* readStdioJsonRpcMessages(input) {
  let buffer = Buffer.alloc(0);
  for await (const chunk of input) {
    buffer = Buffer.concat([buffer, bufferFromChunk(chunk)]);
    while (true) {
      const result = readNextMessage(buffer);
      if (result.kind === "incomplete")
        break;
      buffer = result.remaining;
      if (result.message)
        yield result.message;
    }
  }
  const trailing = buffer.toString("utf8").trim();
  if (trailing.length > 0) {
    yield parseJsonPayload(trailing, "line");
  }
}
async function writeStdioJsonRpcResponse(output, response, responseMode) {
  const body = JSON.stringify(response);
  const payload = responseMode === "framed" ? `Content-Length: ${Buffer.byteLength(body, "utf8")}\r
\r
${body}` : `${body}
`;
  await writeChunk(output, payload);
}
function writeChunk(output, chunk) {
  return new Promise((resolve9, reject) => {
    let settled = false;
    const onError = (error) => {
      if (settled)
        return;
      settled = true;
      reject(error);
    };
    output.once("error", onError);
    try {
      output.write(chunk, (error) => {
        if (settled)
          return;
        settled = true;
        if (error) {
          queueMicrotask(() => output.removeListener("error", onError));
          reject(error);
          return;
        }
        output.removeListener("error", onError);
        resolve9();
      });
    } catch (error) {
      output.removeListener("error", onError);
      if (settled)
        return;
      settled = true;
      reject(error);
    }
  });
}
function readNextMessage(buffer) {
  if (buffer.length === 0)
    return { kind: "incomplete" };
  return startsWithContentLength(buffer) ? readFramedMessage(buffer) : readLineMessage(buffer);
}
function readLineMessage(buffer) {
  const newlineIndex = buffer.indexOf(10);
  if (newlineIndex === -1)
    return { kind: "incomplete" };
  const line = buffer.subarray(0, newlineIndex).toString("utf8").replace(/\r$/, "");
  if (line.trim().length === 0) {
    return { kind: "complete", remaining: buffer.subarray(newlineIndex + 1) };
  }
  return {
    kind: "complete",
    message: parseJsonPayload(line, "line"),
    remaining: buffer.subarray(newlineIndex + 1)
  };
}
function readFramedMessage(buffer) {
  const separatorIndex = buffer.indexOf(HEADER_SEPARATOR);
  if (separatorIndex === -1)
    return { kind: "incomplete" };
  const headers = buffer.subarray(0, separatorIndex).toString("ascii");
  const contentLength = parseContentLength(headers);
  const bodyStart = separatorIndex + HEADER_SEPARATOR.length;
  if (contentLength === undefined) {
    return {
      kind: "complete",
      message: {
        kind: "parse_error",
        message: "Missing or invalid Content-Length header",
        responseMode: "framed"
      },
      remaining: buffer.subarray(bodyStart)
    };
  }
  const bodyEnd = bodyStart + contentLength;
  if (buffer.length < bodyEnd)
    return { kind: "incomplete" };
  const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
  return {
    kind: "complete",
    message: parseJsonPayload(body, "framed"),
    remaining: buffer.subarray(bodyEnd)
  };
}
function startsWithContentLength(buffer) {
  const prefix = buffer.subarray(0, "content-length:".length).toString("ascii").toLowerCase();
  return prefix === "content-length:";
}
function parseContentLength(headers) {
  for (const line of headers.split(`\r
`)) {
    const match = /^content-length:\s*(\d+)$/i.exec(line);
    if (match === null)
      continue;
    const value = match[1];
    if (value === undefined)
      return;
    return Number(value);
  }
  return;
}
function parseJsonPayload(payload, responseMode) {
  try {
    return { kind: "request", payload: JSON.parse(payload), responseMode };
  } catch (error) {
    return { kind: "parse_error", message: error instanceof Error ? error.message : String(error), responseMode };
  }
}
function bufferFromChunk(chunk) {
  if (Buffer.isBuffer(chunk))
    return chunk;
  if (typeof chunk === "string")
    return Buffer.from(chunk);
  throw new TypeError(`Unsupported stdio chunk type: ${typeof chunk}`);
}

// ../../mcp-stdio-core/src/server.ts
var DEFAULT_IDLE_TIMEOUT_MS = 10 * 60000;
var DEFAULT_PARENT_POLL_INTERVAL_MS = 30000;
var noopLog = () => {};
function isProcessAlive2(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !hasErrorCode(error, "ESRCH");
  }
}
async function runJsonRpcStdioServer(config2) {
  const log = config2.log ?? noopLog;
  const idleTimeoutMs = config2.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  let isClosed = false;
  const idleTimer = createIdleTimer(idleTimeoutMs, log, () => {
    isClosed = true;
    config2.onIdleTimeout?.();
    config2.input.destroy();
  });
  const watchdog = createParentWatchdog(config2.parentWatchdog, (parentPid, pollIntervalMs) => {
    isClosed = true;
    log("parent_exit", { parent_pid: parentPid, poll_interval_ms: pollIntervalMs });
    config2.onParentExit?.();
    config2.input.destroy();
  });
  log("stdio_started", { cwd: process.cwd(), idle_timeout_ms: idleTimeoutMs });
  idleTimer.arm();
  try {
    for await (const message of readStdioJsonRpcMessages(config2.input)) {
      if (isClosed)
        break;
      idleTimer.arm();
      if (message.kind === "parse_error") {
        if (!await handleParseError(message, config2, log))
          break;
        continue;
      }
      if (!await handleRequest(message, config2, log))
        break;
    }
  } catch (error) {
    if (!(isClosed && hasErrorCode(error, "ERR_STREAM_PREMATURE_CLOSE")))
      throw error;
  } finally {
    idleTimer.clear();
    watchdog.clear();
    log("stdio_stopped");
  }
}
async function handleParseError(message, config2, log) {
  log("parse_error", { message: message.message });
  const response = config2.parseErrorResponse?.(message.message) ?? errorResponse(null, -32700, "Parse error", message.message);
  if (response === undefined)
    return true;
  return writeResponse(response, {
    output: config2.output,
    responseMode: message.responseMode,
    log
  });
}
async function handleRequest(message, config2, log) {
  const parsed = message.payload;
  const id = isPlainRecord2(parsed) ? jsonRpcId(parsed["id"]) : null;
  const method = isPlainRecord2(parsed) && typeof parsed["method"] === "string" ? parsed["method"] : null;
  log("request", { id: id === null ? null : String(id), method });
  let response;
  try {
    response = await config2.handler(parsed, config2.handlerOptions);
  } catch (error) {
    if (config2.onHandlerError === undefined)
      throw error;
    config2.onHandlerError(error);
    return true;
  }
  if (response === undefined)
    return true;
  if (!await writeResponse(response, {
    output: config2.output,
    responseMode: message.responseMode,
    log
  }))
    return false;
  log("response", { id: String(response.id), method, is_error: response.error !== undefined });
  return true;
}
async function writeResponse(response, context) {
  try {
    await writeStdioJsonRpcResponse(context.output, response, context.responseMode);
    return true;
  } catch (error) {
    if (!isTerminalOutputError(error))
      throw error;
    context.log("output_error", { message: messageFromError(error) });
    return false;
  }
}
function isTerminalOutputError(error) {
  if (!(error instanceof Error) || !("code" in error))
    return false;
  return error.code === "EPIPE" || error.code === "ERR_STREAM_DESTROYED" || error.code === "ERR_STREAM_WRITE_AFTER_END";
}
function hasErrorCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}
function createParentWatchdog(config2, onDeadParent) {
  if (config2 === undefined)
    return { clear: () => {} };
  const pollIntervalMs = config2.pollIntervalMs ?? DEFAULT_PARENT_POLL_INTERVAL_MS;
  if (pollIntervalMs <= 0)
    return { clear: () => {} };
  const parentPid = config2.parentPid ?? process.ppid;
  const probeAlive = config2.probeAlive ?? isProcessAlive2;
  let fired = false;
  const timer = setInterval(() => {
    if (fired)
      return;
    const alive = probeAlive(parentPid);
    config2.onPoll?.(alive);
    if (alive)
      return;
    fired = true;
    onDeadParent(parentPid, pollIntervalMs);
  }, pollIntervalMs);
  timer.unref();
  return {
    clear: () => {
      clearInterval(timer);
    }
  };
}
function createIdleTimer(idleTimeoutMs, log, onTimeout) {
  let timer = null;
  return {
    arm: () => {
      if (timer !== null)
        clearTimeout(timer);
      if (idleTimeoutMs <= 0)
        return;
      timer = setTimeout(() => {
        log("idle_timeout", { idle_timeout_ms: idleTimeoutMs });
        onTimeout();
      }, idleTimeoutMs);
      timer.unref();
    },
    clear: () => {
      if (timer === null)
        return;
      clearTimeout(timer);
      timer = null;
    }
  };
}
// components/codegraph/src/mcp-bridge.ts
class CodegraphBridgeStdioError extends Error {
  streamName;
  name = "CodegraphBridgeStdioError";
  constructor(streamName) {
    super(`CodeGraph MCP bridge missing child ${streamName}`);
    this.streamName = streamName;
  }
}
var CODEGRAPH_NODE_DESCRIPTION = "Inspect one named symbol or file. In symbol mode, includeCode=true includes leaf-symbol source when available. Container symbols such as classes, interfaces, structs, enums, modules, and namespaces return structural outlines with member lists by design. For container source, request a specific member symbol or use file mode with symbolsOnly=false plus offset/limit.";
var CODEGRAPH_NODE_INCLUDE_CODE_DESCRIPTION = "Symbol mode: include leaf-symbol source when available. Container symbols such as classes, interfaces, structs, enums, modules, and namespaces intentionally return structural outlines with members; request a specific member symbol or use file mode with symbolsOnly=false plus offset/limit for source.";
var CODEGRAPH_CONTAINER_OUTLINE_GUIDANCE = "Container symbols intentionally return structural outlines with members. For source, request a specific member symbol or call codegraph_node in file mode with symbolsOnly=false plus offset/limit around the symbol location.";
var SIGKILL_ESCALATION_MS = 2000;
async function runBridgedCodegraphProcess(command, args, options) {
  const invocation = resolveServeProcessInvocation(command, args);
  const child = spawn3(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true
  });
  const childInput = child.stdin;
  const childOutput = child.stdout;
  if (childInput === null)
    throw new CodegraphBridgeStdioError("stdin");
  if (childOutput === null)
    throw new CodegraphBridgeStdioError("stdout");
  const pendingResponses = new Map;
  let defaultResponseMode = "framed";
  const childExit = new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== null) {
        resolveExit(code);
        return;
      }
      resolveExit(signal === null ? 0 : 1);
    });
  });
  const destroyChildPipes = () => {
    childInput.destroy();
    childOutput.destroy();
  };
  childExit.then(destroyChildPipes, destroyChildPipes);
  let parentWatchdogFired = false;
  const parentWatchdog = createParentWatchdog(options.parentWatchdog, () => {
    parentWatchdogFired = true;
    options.input.destroy();
    destroyChildPipes();
    terminateCodegraphChild(child);
  });
  const clientForwardingDone = forwardClientToCodegraph(options.input, childInput, pendingResponses, (mode2) => {
    defaultResponseMode = mode2;
  }, () => parentWatchdogFired);
  const responseForwardingDone = forwardCodegraphToClient(childOutput, options.output, pendingResponses, () => defaultResponseMode, () => parentWatchdogFired);
  const bridgeDone = Promise.all([clientForwardingDone, responseForwardingDone]);
  const childAndResponsesDone = Promise.all([childExit, responseForwardingDone]).then(([exitCode]) => exitCode);
  try {
    return await Promise.race([childAndResponsesDone, bridgeDone.then(() => childExit)]);
  } catch (error) {
    destroyChildPipes();
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await childExit.catch(() => {
      return;
    });
    throw error;
  } finally {
    parentWatchdog.clear();
  }
}
function terminateCodegraphChild(child) {
  if (child.exitCode !== null || child.signalCode !== null)
    return;
  child.kill("SIGTERM");
  const escalation = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  }, SIGKILL_ESCALATION_MS);
  escalation.unref();
}
function isWatchdogTeardownError(error) {
  if (!(error instanceof Error) || !("code" in error))
    return false;
  return error.code === "ERR_STREAM_PREMATURE_CLOSE" || error.code === "ERR_STREAM_DESTROYED" || error.code === "ERR_STREAM_WRITE_AFTER_END" || error.code === "EPIPE";
}
async function forwardClientToCodegraph(input, childInput, pendingResponses, setDefaultResponseMode, tolerateWatchdogClose) {
  try {
    for await (const message of readStdioJsonRpcMessages(input)) {
      if (message.kind === "parse_error") {
        continue;
      }
      const responseMode = message.responseMode;
      setDefaultResponseMode(responseMode);
      const key = responseModeKey(message.payload);
      if (key !== null) {
        pendingResponses.set(key, {
          method: jsonRpcMethod(message.payload),
          responseMode,
          toolName: jsonRpcToolName(message.payload)
        });
      }
      await writeLine(childInput, JSON.stringify(message.payload));
    }
    childInput.end();
  } catch (error) {
    if (!(tolerateWatchdogClose() && isWatchdogTeardownError(error)))
      throw error;
  }
}
async function forwardCodegraphToClient(childOutput, output, pendingResponses, defaultResponseMode, tolerateWatchdogClose) {
  try {
    for await (const message of readStdioJsonRpcMessages(childOutput)) {
      if (message.kind === "parse_error") {
        await writeStdioJsonRpcResponse(output, errorResponse(null, -32700, "Parse error", message.message), defaultResponseMode());
        continue;
      }
      const key = responseModeKey(message.payload);
      const pendingResponse = key === null ? undefined : pendingResponses.get(key);
      const responseMode = pendingResponse?.responseMode ?? defaultResponseMode();
      if (key !== null)
        pendingResponses.delete(key);
      await writeStdioJsonRpcResponse(output, clarifyCodegraphResponse(message.payload, pendingResponse), responseMode);
    }
  } catch (error) {
    if (!(tolerateWatchdogClose() && isWatchdogTeardownError(error)))
      throw error;
  }
}
function responseModeKey(payload) {
  if (!isPlainRecord2(payload) || !("id" in payload))
    return null;
  const id = jsonRpcId(payload["id"]);
  return `${typeof id}:${String(id)}`;
}
function jsonRpcMethod(payload) {
  if (!isPlainRecord2(payload))
    return null;
  const method = payload["method"];
  return typeof method === "string" ? method : null;
}
function jsonRpcToolName(payload) {
  if (jsonRpcMethod(payload) !== "tools/call" || !isPlainRecord2(payload))
    return null;
  const params = payload["params"];
  if (!isPlainRecord2(params))
    return null;
  const name = params["name"];
  return typeof name === "string" ? name : null;
}
function clarifyCodegraphResponse(payload, pendingResponse) {
  if (pendingResponse?.method === "tools/list")
    return clarifyCodegraphToolsList(payload);
  if (pendingResponse?.method === "tools/call" && pendingResponse.toolName === "codegraph_node") {
    return clarifyCodegraphNodeCallResult(payload);
  }
  return payload;
}
function clarifyCodegraphToolsList(payload) {
  if (!isPlainRecord2(payload))
    return payload;
  const result = payload["result"];
  if (!isPlainRecord2(result) || !Array.isArray(result["tools"]))
    return payload;
  let changed = false;
  const tools = result["tools"].map((tool) => {
    if (!isPlainRecord2(tool) || tool["name"] !== "codegraph_node")
      return tool;
    if (!hasCodegraphNodeContractMetadata(tool))
      return tool;
    changed = true;
    return clarifyCodegraphNodeTool(tool);
  });
  if (!changed)
    return payload;
  return { ...payload, result: { ...result, tools } };
}
function clarifyCodegraphNodeTool(tool) {
  const clarified = {
    ...tool,
    description: CODEGRAPH_NODE_DESCRIPTION
  };
  const inputSchema = tool["inputSchema"];
  if (isPlainRecord2(inputSchema))
    clarified["inputSchema"] = clarifyCodegraphNodeInputSchema(inputSchema);
  return clarified;
}
function hasCodegraphNodeContractMetadata(tool) {
  if (typeof tool["description"] === "string")
    return true;
  const inputSchema = tool["inputSchema"];
  if (!isPlainRecord2(inputSchema))
    return false;
  const properties = inputSchema["properties"];
  return isPlainRecord2(properties) && isPlainRecord2(properties["includeCode"]);
}
function clarifyCodegraphNodeInputSchema(inputSchema) {
  const properties = inputSchema["properties"];
  if (!isPlainRecord2(properties))
    return inputSchema;
  const includeCode = properties["includeCode"];
  if (!isPlainRecord2(includeCode))
    return inputSchema;
  return {
    ...inputSchema,
    properties: {
      ...properties,
      includeCode: {
        ...includeCode,
        description: CODEGRAPH_NODE_INCLUDE_CODE_DESCRIPTION
      }
    }
  };
}
function clarifyCodegraphNodeCallResult(payload) {
  if (!isPlainRecord2(payload))
    return payload;
  const result = payload["result"];
  if (!isPlainRecord2(result) || !Array.isArray(result["content"]))
    return payload;
  let changed = false;
  const content = result["content"].map((item) => {
    if (!isPlainRecord2(item) || item["type"] !== "text" || typeof item["text"] !== "string")
      return item;
    const text = clarifyContainerOutlineGuidance(item["text"]);
    if (text === item["text"])
      return item;
    changed = true;
    return { ...item, text };
  });
  if (!changed)
    return payload;
  return { ...payload, result: { ...result, content } };
}
function clarifyContainerOutlineGuidance(text) {
  if (!text.includes("Structural outline only"))
    return text;
  return text.replace(/Structural outline only[^\n]*(?:\n[^\n]*(?:Read|read)[^\n]*)?/g, CODEGRAPH_CONTAINER_OUTLINE_GUIDANCE);
}
async function writeLine(output, line) {
  if (output.write(`${line}
`))
    return;
  await new Promise((resolveDrain, reject) => {
    output.once("drain", resolveDrain);
    output.once("error", reject);
  });
}

// components/codegraph/src/mcp-unavailable.ts
async function runUnavailableCodegraphMcpServer(options) {
  await runJsonRpcStdioServer({
    handler: handleUnavailableCodegraphMcpRequest,
    handlerOptions: {
      reason: options.reason.trim(),
      serverVersion: options.serverVersion
    },
    input: options.input,
    output: options.output,
    idleTimeoutMs: 0,
    parentWatchdog: options.parentWatchdog ?? {},
    ...options.lifecycleLog === undefined ? {} : { log: options.lifecycleLog }
  });
}
async function handleUnavailableCodegraphMcpRequest(input, options) {
  if (!isPlainRecord2(input)) {
    return errorResponse(null, -32600, "Invalid Request");
  }
  const id = jsonRpcId(input["id"]);
  const method = input["method"];
  if (method === "notifications/initialized")
    return;
  if (method === "ping")
    return successResponse(id, {});
  if (method === "initialize") {
    return successResponse(id, {
      capabilities: { tools: { listChanged: false } },
      protocolVersion: requestedProtocolVersion(input["params"]),
      serverInfo: { name: "codegraph", version: options.serverVersion }
    });
  }
  if (method === "tools/list") {
    return successResponse(id, { tools: [] });
  }
  if (method === "tools/call") {
    return successResponse(id, {
      content: [{ text: options.reason, type: "text" }],
      isError: true
    });
  }
  return errorResponse(id, -32601, `Method not found: ${String(method)}`);
}
function requestedProtocolVersion(params) {
  if (!isPlainRecord2(params) || typeof params["protocolVersion"] !== "string")
    return "2024-11-05";
  return params["protocolVersion"];
}

// components/codegraph/src/serve.ts
var CODEGRAPH_SKIP_HINT = `CodeGraph MCP skipped: codegraph binary not found. Install CodeGraph or set OMO_CODEGRAPH_BIN.
`;
var CODEGRAPH_DISABLED_HINT = `CodeGraph MCP skipped: disabled by OMO SOT config. Set [codex].codegraph.enabled=true to enable it.
`;
var CODEGRAPH_EXCLUDED_HINT = `CodeGraph MCP skipped: project excluded by OMO CodeGraph policy.
`;
var CODEGRAPH_VERSION = CODEGRAPH_PINNED_VERSION;
var PROJECT_CWD_ENV_KEYS = ["OMO_CODEGRAPH_PROJECT_CWD", SESSION_START_CWD_ENV, "PWD"];
async function runCodegraphServe(options = {}) {
  const env = options.env ?? processEnv6;
  const homeDir = options.homeDir ?? homedir13();
  const wrapperCwd = options.cwd ?? processCwd3();
  const projectCwd = resolveProjectCwd(env, wrapperCwd);
  const config2 = options.config ?? getCodexOmoConfig({ cwd: projectCwd, env, homeDir });
  const codegraphConfig = config2.codegraph ?? {};
  if (codegraphConfig.enabled === false) {
    return runUnavailableMcp(CODEGRAPH_DISABLED_HINT, options);
  }
  const excludedRoots = codegraphConfig.excluded_roots;
  const exclusion = shouldExcludeCodegraphProject(projectCwd, {
    homeDir,
    ...excludedRoots === undefined ? {} : { excludedRoots }
  });
  if (exclusion.excluded) {
    return runUnavailableMcp(CODEGRAPH_EXCLUDED_HINT, options);
  }
  const trustedInstallDir = config2.trustedCodegraphInstallDir;
  const installDir = trustedInstallDir ?? join22(homeDir, ".omo", "codegraph");
  const resolutionOptions = {
    env,
    homeDir,
    provisioned: () => provisionedBinFromInstallDir(installDir)
  };
  let resolution = options.resolve?.(resolutionOptions) ?? resolveCodegraphCommand(resolutionOptions);
  const resolveManagedBin = options.resolveManagedBin ?? (options.resolve === undefined ? provisionedBinFromInstallDir : () => null);
  const managedInstallExists = options.managedInstallExists ?? (options.resolve === undefined ? hasCodegraphManagedInstall : () => false);
  const managedBin = resolveManagedBin(installDir);
  if (resolution.source !== "env" && managedBin !== null) {
    resolution = { argsPrefix: [], command: managedBin, exists: true, source: "provisioned" };
  } else if (resolution.source !== "env" && codegraphConfig.auto_provision !== false && managedInstallExists(installDir)) {
    const upgraded = await provisionMissingCodegraph({
      config: codegraphConfig,
      ensureProvisioned: options.ensureProvisioned ?? ensureCodegraphProvisioned,
      homeDir,
      resolution,
      ...trustedInstallDir === undefined ? {} : { trustedInstallDir }
    });
    if (upgraded !== null)
      resolution = upgraded;
  }
  const nodeSupport = evaluateCodegraphNodeSupport({ env, nodeVersion: options.nodeVersion });
  if (!resolution.exists || shouldSkipResolvedCommand(resolution, options.commandExists ?? existsSync11)) {
    if (resolution.source === "path" && !nodeSupport.supported) {
      return runUnavailableMcp(buildCodegraphNodeSkipHint(nodeSupport), options);
    }
    const provisioned = await provisionMissingCodegraph({
      config: codegraphConfig,
      ensureProvisioned: options.ensureProvisioned ?? ensureCodegraphProvisioned,
      homeDir,
      resolution,
      ...trustedInstallDir === undefined ? {} : { trustedInstallDir }
    });
    if (provisioned === null) {
      return runUnavailableMcp(CODEGRAPH_SKIP_HINT, options);
    }
    resolution = provisioned;
  }
  if (codegraphCommandRequiresSupportedLocalNode(resolution) && !nodeSupport.supported) {
    return runUnavailableMcp(buildCodegraphNodeSkipHint(nodeSupport), options);
  }
  const runProcess = options.runProcess ?? runBridgedCodegraphProcess;
  const codegraphEnv = codegraphEnvForConfig(trustedInstallDir, homeDir, codegraphConfig.daemon !== false, options.buildEnv);
  const mergedEnv = buildCodegraphChildEnv({ ambientEnv: env, codegraphEnv, runtimeEnv: env });
  return runProcess(resolution.command, [...resolution.argsPrefix, "serve", "--mcp"], {
    cwd: projectCwd,
    env: mergedEnv,
    input: options.stdin ?? processStdin3,
    output: options.stdout ?? processStdout3,
    stderr: options.stderr ?? processStderr4,
    stdio: "pipe",
    parentWatchdog: options.parentWatchdog ?? {}
  });
}
async function runUnavailableMcp(reason, options) {
  (options.stderr ?? processStderr4).write(reason);
  await runUnavailableCodegraphMcpServer({
    input: options.stdin ?? processStdin3,
    output: options.stdout ?? processStdout3,
    reason,
    serverVersion: CODEGRAPH_VERSION,
    parentWatchdog: options.parentWatchdog ?? {}
  });
  return 0;
}
async function provisionMissingCodegraph(options) {
  if (options.resolution.source === "env")
    return null;
  if (options.config.auto_provision === false)
    return null;
  const installDir = options.trustedInstallDir ?? join22(options.homeDir, ".omo", "codegraph");
  const result = await options.ensureProvisioned({
    installDir,
    lockDir: join22(installDir, ".locks"),
    version: CODEGRAPH_VERSION
  });
  if (!result.provisioned || result.binPath === undefined)
    return null;
  return { argsPrefix: [], command: result.binPath, exists: true, source: "provisioned" };
}
function shouldSkipResolvedCommand(resolution, commandExists) {
  if (resolution.source !== "env")
    return false;
  if (!looksLikePath2(resolution.command))
    return false;
  return !commandExists(resolution.command);
}
function looksLikePath2(command) {
  return command.includes("/") || command.includes("\\");
}
function codegraphEnvForConfig(trustedInstallDir, homeDir, daemon, buildEnv) {
  const env = buildEnv?.({ daemon, homeDir }) ?? buildCodegraphEnv({ daemon, homeDir });
  return trustedInstallDir === undefined ? env : { ...env, CODEGRAPH_INSTALL_DIR: trustedInstallDir };
}
function resolveProjectCwd(env, fallback) {
  for (const key of PROJECT_CWD_ENV_KEYS) {
    const candidate = env[key]?.trim();
    if (candidate === undefined || candidate.length === 0)
      continue;
    const resolved = resolve9(candidate);
    if (existsSync11(resolved))
      return resolved;
  }
  return resolve9(fallback);
}
function provisionedBinFromInstallDir(installDir) {
  return resolvePinnedCodegraphBin(installDir);
}
async function runCodegraphServeCli() {
  process.exitCode = await runCodegraphServe();
}
if (isDirectInvocation(process.argv[1])) {
  runCodegraphServeCli().catch((error) => {
    processStderr4.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}
`);
    process.exitCode = 1;
  });
}
function isDirectInvocation(argvPath) {
  if (argvPath === undefined)
    return false;
  const modulePath = fileURLToPath3(import.meta.url);
  const moduleName = basename6(modulePath);
  if (moduleName !== "serve.js" && moduleName !== "serve.ts")
    return false;
  return realpathSync8(resolve9(argvPath)) === realpathSync8(modulePath);
}

// components/codegraph/src/sweep-cli.ts
async function runCodegraphSweepCli(options = {}) {
  const args = parseSweepCliArgs(options.argv ?? process.argv);
  const result = await sweepCodegraphZombies({
    ...options,
    dryRun: args.dryRun,
    extraRoots: args.roots,
    force: args.force,
    ...args.roots.length > 0 ? { ownedRoots: args.roots } : {}
  });
  writeSweepReport(options.stdout ?? process.stdout, result);
  return result.action === "failed" ? 1 : 0;
}
function parseSweepCliArgs(argv) {
  const roots = [];
  let dryRun = false;
  let force = false;
  for (let index = 3;index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--root") {
      const value = argv[index + 1];
      if (value !== undefined && value.trim().length > 0)
        roots.push(value);
      index += 1;
    }
  }
  return { dryRun, force, roots };
}
function writeSweepReport(stdout, result) {
  stdout.write(`${JSON.stringify({
    action: result.action,
    candidates: result.candidates.map(formatProcess),
    dryRun: result.dryRun,
    failed: result.failed,
    killed: result.killed.map(formatProcess),
    ownedRoots: result.ownedRoots,
    spared: result.spared.map(formatProcess),
    stampFile: result.stampFile
  })}
`);
}
function formatProcess(processInfo) {
  return {
    matchKind: processInfo.matchKind,
    matchedRoot: processInfo.matchedRoot,
    pid: processInfo.pid,
    ppid: processInfo.ppid
  };
}

// components/codegraph/src/cli.ts
async function runCodegraphCli(options = {}) {
  const argv = options.argv ?? process.argv;
  const command = argv[2];
  const subcommand = argv[3];
  if (command === "sweep") {
    return runCodegraphSweepCli({
      ...options.sweepOptions,
      argv,
      ...options.env === undefined ? {} : { env: options.env },
      ...options.stdout === undefined ? {} : { stdout: options.stdout }
    });
  }
  if (command === "hook" && subcommand === "session-start") {
    return runCodegraphSessionStartHook(options);
  }
  if (command === "hook" && subcommand === "post-tool-use") {
    const hookOptions = {
      ...options.env === undefined ? {} : { env: options.env },
      ...options.stdin === undefined ? {} : { stdin: options.stdin },
      ...options.stdout === undefined ? {} : { stdout: options.stdout }
    };
    return runCodegraphPostToolUseHookCli(hookOptions);
  }
  if (command === "hook" && subcommand === "session-start-worker") {
    const workerOptions = {
      ...options.workerOptions,
      ...options.workerOptions?.cwd === undefined && options.cwd !== undefined ? { cwd: options.cwd } : {},
      ...options.workerOptions?.env === undefined && options.env !== undefined ? { env: options.env } : {}
    };
    await runCodegraphSessionStartWorker(workerOptions);
    return 0;
  }
  await runCodegraphServeCli();
  return process.exitCode === undefined ? 0 : Number(process.exitCode);
}
if (isDirectInvocation2(process.argv[1])) {
  runCodegraphCli().catch((error) => {
    processStderr5.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}
`);
    process.exitCode = 1;
  });
}
function isDirectInvocation2(argvPath) {
  if (argvPath === undefined)
    return false;
  const modulePath = fileURLToPath4(import.meta.url);
  const moduleName = basename7(modulePath);
  if (moduleName !== "cli.js" && moduleName !== "cli.ts")
    return false;
  return realpathSync9(resolve10(argvPath)) === realpathSync9(modulePath);
}
export {
  runCodegraphCli
};
