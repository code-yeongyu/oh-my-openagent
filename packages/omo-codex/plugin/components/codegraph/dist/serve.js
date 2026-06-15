#!/usr/bin/env node
import { createRequire } from "node:module";
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// ../../../../../node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/umd/main.js
var require_main = __commonJS((exports, module) => {
  (function(factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
      var v = factory(__require, exports);
      if (v !== undefined)
        module.exports = v;
    } else if (typeof define === "function" && define.amd) {
      define(["require", "exports", "./impl/format", "./impl/edit", "./impl/scanner", "./impl/parser"], factory);
    }
  })(function(require2, exports2) {
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.applyEdits = exports2.modify = exports2.format = exports2.printParseErrorCode = exports2.ParseErrorCode = exports2.stripComments = exports2.visit = exports2.getNodeValue = exports2.getNodePath = exports2.findNodeAtOffset = exports2.findNodeAtLocation = exports2.parseTree = exports2.parse = exports2.getLocation = exports2.SyntaxKind = exports2.ScanError = exports2.createScanner = undefined;
    const formatter = require2("./impl/format");
    const edit = require2("./impl/edit");
    const scanner = require2("./impl/scanner");
    const parser = require2("./impl/parser");
    exports2.createScanner = scanner.createScanner;
    var ScanError;
    (function(ScanError2) {
      ScanError2[ScanError2["None"] = 0] = "None";
      ScanError2[ScanError2["UnexpectedEndOfComment"] = 1] = "UnexpectedEndOfComment";
      ScanError2[ScanError2["UnexpectedEndOfString"] = 2] = "UnexpectedEndOfString";
      ScanError2[ScanError2["UnexpectedEndOfNumber"] = 3] = "UnexpectedEndOfNumber";
      ScanError2[ScanError2["InvalidUnicode"] = 4] = "InvalidUnicode";
      ScanError2[ScanError2["InvalidEscapeCharacter"] = 5] = "InvalidEscapeCharacter";
      ScanError2[ScanError2["InvalidCharacter"] = 6] = "InvalidCharacter";
    })(ScanError || (exports2.ScanError = ScanError = {}));
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
    })(SyntaxKind || (exports2.SyntaxKind = SyntaxKind = {}));
    exports2.getLocation = parser.getLocation;
    exports2.parse = parser.parse;
    exports2.parseTree = parser.parseTree;
    exports2.findNodeAtLocation = parser.findNodeAtLocation;
    exports2.findNodeAtOffset = parser.findNodeAtOffset;
    exports2.getNodePath = parser.getNodePath;
    exports2.getNodeValue = parser.getNodeValue;
    exports2.visit = parser.visit;
    exports2.stripComments = parser.stripComments;
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
    })(ParseErrorCode || (exports2.ParseErrorCode = ParseErrorCode = {}));
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
    exports2.printParseErrorCode = printParseErrorCode;
    function format(documentText, range, options) {
      return formatter.format(documentText, range, options);
    }
    exports2.format = format;
    function modify(text, path, value, options) {
      return edit.setProperty(text, path, value, options);
    }
    exports2.modify = modify;
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
          text = edit.applyEdit(text, e);
        } else {
          throw new Error("Overlapping edit");
        }
        lastModifiedOffset = e.offset;
      }
      return text;
    }
    exports2.applyEdits = applyEdits;
  });
});

// src/serve.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync4, realpathSync } from "node:fs";
import { homedir as homedir4 } from "node:os";
import { basename, join as join5, resolve as resolve2 } from "node:path";
import { cwd as processCwd, env as processEnv, stderr as processStderr } from "node:process";
import { fileURLToPath } from "node:url";

// ../../../../utils/src/codegraph/env.ts
import { homedir } from "node:os";
import { join } from "node:path";
var CODEGRAPH_INSTALL_DIR_ENV = "CODEGRAPH_INSTALL_DIR";
var CODEGRAPH_NO_DOWNLOAD_ENV = "CODEGRAPH_NO_DOWNLOAD";
var CODEGRAPH_TELEMETRY_ENV = "CODEGRAPH_TELEMETRY";
var DO_NOT_TRACK_ENV = "DO_NOT_TRACK";
function buildCodegraphEnv(options = {}) {
  const homeDir = options.homeDir ?? homedir();
  return {
    [CODEGRAPH_INSTALL_DIR_ENV]: join(homeDir, ".omo", "codegraph"),
    [CODEGRAPH_NO_DOWNLOAD_ENV]: "1",
    [CODEGRAPH_TELEMETRY_ENV]: "0",
    [DO_NOT_TRACK_ENV]: "1"
  };
}

// ../../../../utils/src/codegraph/resolve.ts
import { existsSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname, join as join3 } from "node:path";
import { createRequire as createRequire2 } from "node:module";

// ../../../../utils/src/runtime/which.ts
import { accessSync, constants } from "node:fs";
import { delimiter, join as join2 } from "node:path";
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
      const candidatePath = join2(pathEntry, candidateName);
      if (isExecutable(candidatePath))
        return candidatePath;
    }
  }
  return null;
}

// ../../../../utils/src/codegraph/resolve.ts
var CODEGRAPH_PACKAGE = "@colbymchenry/codegraph";
var CODEGRAPH_ENV_BIN = "OMO_CODEGRAPH_BIN";
var requireFromHere = createRequire2(import.meta.url);
function defaultRequireResolve(specifier) {
  return requireFromHere.resolve(specifier);
}
function defaultNodeRuntime() {
  return process.execPath || null;
}
function defaultProvisionedBin(homeDir, fileExists) {
  const binaryName = process.platform === "win32" ? "codegraph.cmd" : "codegraph";
  const candidates = [
    join3(homeDir, ".omo", "codegraph", "bin", binaryName),
    join3(homeDir, ".omo", "codegraph", "node-servers", "node_modules", ".bin", binaryName)
  ];
  return candidates.find((candidate) => fileExists(candidate)) ?? null;
}
function resolveBundledShim(requireResolve, fileExists) {
  try {
    const packageJson = requireResolve(`${CODEGRAPH_PACKAGE}/package.json`);
    const packageRoot = dirname(packageJson);
    const candidates = [join3(packageRoot, "bin", "codegraph.js"), join3(packageRoot, "npm-shim.js")];
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
  const configuredBin = env[CODEGRAPH_ENV_BIN]?.trim();
  if (configuredBin !== undefined && configuredBin.length > 0) {
    return { argsPrefix: [], command: configuredBin, exists: true, source: "env" };
  }
  const fileExists = options.fileExists ?? existsSync;
  const nodeRuntime = options.nodeRuntime ?? defaultNodeRuntime;
  const bundled = resolveBundledShim(options.requireResolve ?? defaultRequireResolve, fileExists);
  const runtime2 = nodeRuntime();
  if (bundled !== null && runtime2 !== null) {
    return { argsPrefix: [bundled], command: runtime2, exists: true, source: "bundled" };
  }
  const provisioned = options.provisioned?.() ?? defaultProvisionedBin(options.homeDir ?? homedir2(), fileExists);
  if (provisioned !== null && fileExists(provisioned)) {
    return { argsPrefix: [], command: provisioned, exists: true, source: "provisioned" };
  }
  const pathCommand = (options.which ?? bunWhich)("codegraph");
  return {
    argsPrefix: [],
    command: pathCommand ?? "codegraph",
    exists: pathCommand !== null,
    source: "path"
  };
}

// ../../../../utils/src/omo-config/loader.ts
import { existsSync as existsSync3, readFileSync } from "node:fs";
import { homedir as homedir3 } from "node:os";

// ../../../../utils/src/deep-merge.ts
var DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
function isUnsafeObjectKey(key) {
  return DANGEROUS_KEYS.has(key);
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
}

// ../../../../utils/src/jsonc-parser.ts
var import_jsonc_parser = __toESM(require_main(), 1);
var pluginConfigFileDetectionCache = new Map;
function stripBom(content) {
  return content.charCodeAt(0) === 65279 ? content.slice(1) : content;
}
function parseJsoncSafe(content) {
  const errors = [];
  const data = import_jsonc_parser.parse(stripBom(content), errors, {
    allowTrailingComma: true,
    disallowComments: false
  });
  return {
    data: errors.length > 0 ? null : data,
    errors: errors.map((e) => ({
      message: import_jsonc_parser.printParseErrorCode(e.error),
      offset: e.offset,
      length: e.length
    }))
  };
}

// ../../../../utils/src/omo-config.ts
var HARNESS_IDS = ["codex", "opencode", "omo"];
var SETTING_HARNESS_SUPPORT = {
  "codegraph.auto_provision": HARNESS_IDS,
  "codegraph.enabled": HARNESS_IDS,
  "codegraph.install_dir": HARNESS_IDS,
  "codegraph.telemetry": HARNESS_IDS,
  "codegraph.watch_debounce_ms": ["opencode", "omo"]
};

// ../../../../utils/src/omo-config/env-overrides.ts
var CODEGRAPH_ENV_KEYS = [
  ["auto_provision", "AUTO_PROVISION", "boolean"],
  ["enabled", "ENABLED", "boolean"],
  ["install_dir", "INSTALL_DIR", "string"],
  ["telemetry", "TELEMETRY", "boolean"],
  ["watch_debounce_ms", "WATCH_DEBOUNCE_MS", "number"]
];
function parseBooleanEnv(value) {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized))
    return true;
  if (["0", "false", "no", "off"].includes(normalized))
    return false;
  return null;
}
function parseEnvValue(value, kind) {
  if (kind === "boolean")
    return parseBooleanEnv(value);
  if (kind === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return value;
}
function setCodegraphSetting(config, key, value) {
  switch (key) {
    case "auto_provision":
      if (typeof value === "boolean")
        config.auto_provision = value;
      return;
    case "enabled":
      if (typeof value === "boolean")
        config.enabled = value;
      return;
    case "install_dir":
      if (typeof value === "string")
        config.install_dir = value;
      return;
    case "telemetry":
      if (typeof value === "boolean")
        config.telemetry = value;
      return;
    case "watch_debounce_ms":
      if (typeof value === "number")
        config.watch_debounce_ms = value;
      return;
  }
}
function buildEnvOverrides(harness, env, warnings, merge) {
  let config = {};
  for (const prefix of ["OMO", harness.toUpperCase()]) {
    const codegraph = {};
    for (const [settingKey, envSuffix, kind] of CODEGRAPH_ENV_KEYS) {
      const envKey = `${prefix}_CODEGRAPH_${envSuffix}`;
      const rawValue = env[envKey];
      if (rawValue === undefined)
        continue;
      const parsed = parseEnvValue(rawValue, kind);
      if (parsed === null) {
        warnings.push(`${envKey} has invalid ${kind} value "${rawValue}"`);
        continue;
      }
      setCodegraphSetting(codegraph, settingKey, parsed);
    }
    if (Object.keys(codegraph).length > 0) {
      config = merge(config, { codegraph });
    }
  }
  return config;
}

// ../../../../utils/src/omo-config/resolve.ts
import { existsSync as existsSync2 } from "node:fs";
import { dirname as dirname2, isAbsolute, join as join4, relative, resolve } from "node:path";
function containsPath(parent, child) {
  const pathToChild = relative(parent, child);
  return pathToChild === "" || !pathToChild.startsWith("..") && !isAbsolute(pathToChild);
}
function findProjectConfigPathsNearestFirst(cwd, homeDir) {
  const startDir = resolve(cwd);
  const stopBeforeDir = containsPath(resolve(homeDir), startDir) ? resolve(homeDir) : null;
  const paths = [];
  let currentDir = startDir;
  while (true) {
    if (stopBeforeDir !== null && currentDir === stopBeforeDir)
      break;
    const configPath = join4(currentDir, ".omo", "config.jsonc");
    if (existsSync2(configPath)) {
      paths.push(configPath);
    }
    const parentDir = dirname2(currentDir);
    if (parentDir === currentDir)
      break;
    currentDir = parentDir;
  }
  return paths;
}
function resolveOmoConfigPaths(options) {
  const globalPath = join4(resolve(options.homeDir), ".omo", "config.jsonc");
  const projectPathsFarthestFirst = findProjectConfigPathsNearestFirst(options.cwd, options.homeDir).reverse();
  return [
    { path: globalPath, scope: "global" },
    ...projectPathsFarthestFirst.map((path) => ({ path, scope: "project" }))
  ];
}
function toMissingSource(candidate) {
  return {
    exists: false,
    loaded: false,
    path: candidate.path,
    scope: candidate.scope
  };
}

// ../../../../utils/src/omo-config/loader.ts
var BUILT_IN_DEFAULTS = {
  codegraph: {
    auto_provision: true,
    enabled: true,
    telemetry: false
  }
};
var HARNESS_BLOCK_KEYS = HARNESS_IDS.map((harness) => `[${harness}]`);
var CODEGRAPH_SETTING_KEYS = [
  "auto_provision",
  "enabled",
  "install_dir",
  "telemetry",
  "watch_debounce_ms"
];
function isRecord(value) {
  return isPlainObject(value);
}
function hasOwn(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}
function isCodegraphSettingKey(key) {
  return CODEGRAPH_SETTING_KEYS.some((candidate) => candidate === key);
}
function mergeValues(base, override) {
  if (override === undefined)
    return base;
  if (Array.isArray(base) && Array.isArray(override)) {
    return [...new Set([...base, ...override])];
  }
  if (isPlainObject(base) && isPlainObject(override)) {
    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
      if (isUnsafeObjectKey(key))
        continue;
      result[key] = mergeValues(result[key], value);
    }
    return result;
  }
  return override;
}
function mergeCodegraphConfig(base, override) {
  const merged = mergeValues(base, override);
  if (!isRecord(merged))
    return;
  const codegraph = {};
  for (const key of CODEGRAPH_SETTING_KEYS) {
    if (!hasOwn(merged, key))
      continue;
    setCodegraphSetting2(codegraph, key, merged[key]);
  }
  return Object.keys(codegraph).length > 0 ? codegraph : undefined;
}
function mergeOmoConfig(base, override) {
  const codegraph = mergeCodegraphConfig(base.codegraph, override.codegraph);
  return {
    ...codegraph === undefined ? {} : { codegraph }
  };
}
function isHarnessBlockKey(key) {
  return key.startsWith("[") && key.endsWith("]");
}
function isKnownHarnessBlockKey(key) {
  return HARNESS_BLOCK_KEYS.includes(key);
}
function validateCodegraphValue(key, value) {
  if (key === "install_dir")
    return typeof value === "string" ? null : "must be a string";
  if (key === "watch_debounce_ms") {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? null : "must be a non-negative finite number";
  }
  return typeof value === "boolean" ? null : "must be a boolean";
}
function setCodegraphSetting2(config, key, value) {
  switch (key) {
    case "auto_provision":
      if (typeof value === "boolean")
        config.auto_provision = value;
      return;
    case "enabled":
      if (typeof value === "boolean")
        config.enabled = value;
      return;
    case "install_dir":
      if (typeof value === "string")
        config.install_dir = value;
      return;
    case "telemetry":
      if (typeof value === "boolean")
        config.telemetry = value;
      return;
    case "watch_debounce_ms":
      if (typeof value === "number")
        config.watch_debounce_ms = value;
      return;
  }
}
function normalizeCodegraphSection(section, pathPrefix, warnings) {
  if (!isRecord(section)) {
    warnings.push(`${pathPrefix} must be an object`);
    return {};
  }
  const codegraph = {};
  for (const [key, value] of Object.entries(section)) {
    if (!isCodegraphSettingKey(key)) {
      warnings.push(`${pathPrefix}.${key} is not a supported setting`);
      continue;
    }
    const error = validateCodegraphValue(key, value);
    if (error !== null) {
      warnings.push(`${pathPrefix}.${key} ${error}`);
      continue;
    }
    setCodegraphSetting2(codegraph, key, value);
  }
  return codegraph;
}
function normalizeConfigBody(value, pathPrefix, warnings) {
  if (!isRecord(value)) {
    warnings.push(`${pathPrefix} must be an object`);
    return {};
  }
  const config = {};
  for (const [key, section] of Object.entries(value)) {
    if (key === "codegraph") {
      config.codegraph = normalizeCodegraphSection(section, `${pathPrefix}.codegraph`, warnings);
      continue;
    }
    if (isHarnessBlockKey(key)) {
      if (!isKnownHarnessBlockKey(key)) {
        warnings.push(`Unknown harness override block "${key}"`);
      }
      continue;
    }
    warnings.push(`${pathPrefix}.${key} is not a supported setting`);
  }
  return config;
}
function normalizeActiveHarnessBlock(value, harness, pathPrefix, warnings) {
  if (!isRecord(value))
    return {};
  const blockKey = `[${harness}]`;
  if (!hasOwn(value, blockKey))
    return {};
  return normalizeConfigBody(value[blockKey], `${pathPrefix}.${blockKey}`, warnings);
}
function loadConfigFile(path, harness) {
  try {
    const content = readFileSync(path, "utf-8");
    const parsed = parseJsoncSafe(content);
    if (parsed.errors.length > 0) {
      return {
        config: {},
        loaded: false,
        warnings: parsed.errors.map((error) => `JSONC parse error in ${path}: ${error.message} at offset ${error.offset}`)
      };
    }
    const warnings = [];
    const baseConfig = normalizeConfigBody(parsed.data, "config", warnings);
    const harnessConfig = normalizeActiveHarnessBlock(parsed.data, harness, "config", warnings);
    return {
      config: mergeOmoConfig(baseConfig, harnessConfig),
      loaded: true,
      warnings
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      config: {},
      loaded: false,
      warnings: [`Failed to read ${path}: ${message}`]
    };
  }
}
function validateHarnessApplicability(config, harness) {
  const warnings = [];
  const codegraph = config.codegraph;
  if (codegraph === undefined)
    return warnings;
  for (const key of Object.keys(codegraph)) {
    if (!isCodegraphSettingKey(key))
      continue;
    const settingPath = `codegraph.${key}`;
    const supportedHarnesses = SETTING_HARNESS_SUPPORT[settingPath];
    if (supportedHarnesses === undefined)
      continue;
    if (!supportedHarnesses.includes(harness)) {
      warnings.push(`${settingPath} is not supported for harness ${harness}`);
    }
  }
  return warnings;
}
function loadOmoConfig(options) {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? process.env["HOME"] ?? process.env["USERPROFILE"] ?? homedir3();
  const env = options.env ?? process.env;
  let config = BUILT_IN_DEFAULTS;
  const sources = [];
  const warnings = [];
  for (const candidate of resolveOmoConfigPaths({ cwd, homeDir })) {
    if (!existsSync3(candidate.path)) {
      if (candidate.scope === "global") {
        sources.push(toMissingSource(candidate));
      }
      continue;
    }
    const result = loadConfigFile(candidate.path, options.harness);
    sources.push({
      exists: true,
      loaded: result.loaded,
      path: candidate.path,
      scope: candidate.scope
    });
    warnings.push(...result.warnings);
    config = mergeOmoConfig(config, result.config);
  }
  const envOverrides = buildEnvOverrides(options.harness, env, warnings, mergeOmoConfig);
  config = mergeOmoConfig(config, envOverrides);
  warnings.push(...validateHarnessApplicability(config, options.harness));
  return { config, sources, warnings };
}

// ../../shared/src/config-loader.ts
function getCodexOmoConfig(options = {}) {
  const result = loadOmoConfig({
    ...options.cwd === undefined ? {} : { cwd: options.cwd },
    ...options.env === undefined ? {} : { env: options.env },
    ...options.homeDir === undefined ? {} : { homeDir: options.homeDir },
    harness: "codex"
  });
  return {
    ...result.config,
    sources: result.sources,
    warnings: result.warnings
  };
}

// src/serve.ts
var CODEGRAPH_SKIP_HINT = `CodeGraph MCP skipped: codegraph binary not found. Install CodeGraph or set OMO_CODEGRAPH_BIN.
`;
var CODEGRAPH_DISABLED_HINT = `CodeGraph MCP skipped: disabled by OMO SOT config. Set [codex].codegraph.enabled=true to enable it.
`;
async function runCodegraphServe(options = {}) {
  const env = options.env ?? processEnv;
  const homeDir = options.homeDir ?? homedir4();
  const config = options.config ?? getCodexOmoConfig({ cwd: options.cwd ?? processCwd(), env, homeDir });
  const codegraphConfig = config.codegraph ?? {};
  if (codegraphConfig.enabled === false) {
    (options.stderr ?? processStderr).write(CODEGRAPH_DISABLED_HINT);
    return 1;
  }
  const resolutionOptions = {
    env,
    homeDir,
    provisioned: () => provisionedBinFromInstallDir(codegraphConfig.install_dir)
  };
  const resolution = options.resolve?.(resolutionOptions) ?? resolveCodegraphCommand(resolutionOptions);
  if (!resolution.exists || shouldSkipResolvedCommand(resolution, options.commandExists ?? existsSync4)) {
    (options.stderr ?? processStderr).write(CODEGRAPH_SKIP_HINT);
    return 1;
  }
  const runProcess = options.runProcess ?? runChildProcess;
  const codegraphEnv = codegraphEnvForConfig(codegraphConfig, homeDir, options.buildEnv);
  const mergedEnv = {
    ...env,
    ...codegraphEnv
  };
  return runProcess(resolution.command, [...resolution.argsPrefix, "serve", "--mcp"], {
    env: mergedEnv,
    stdio: "inherit"
  });
}
function shouldSkipResolvedCommand(resolution, commandExists) {
  if (resolution.source !== "env")
    return false;
  if (!looksLikePath(resolution.command))
    return false;
  return !commandExists(resolution.command);
}
function looksLikePath(command) {
  return command.includes("/") || command.includes("\\");
}
function codegraphEnvForConfig(config, homeDir, buildEnv) {
  const env = buildEnv?.({ homeDir }) ?? buildCodegraphEnv({ homeDir });
  return config.install_dir === undefined ? env : { ...env, CODEGRAPH_INSTALL_DIR: config.install_dir };
}
function provisionedBinFromInstallDir(installDir) {
  if (installDir === undefined)
    return null;
  const candidate = join5(installDir, "bin", process.platform === "win32" ? "codegraph.exe" : "codegraph");
  return existsSync4(candidate) ? candidate : null;
}
async function runCodegraphServeCli() {
  process.exitCode = await runCodegraphServe();
}
async function runChildProcess(command, args, options) {
  const child = spawn(command, args, { env: options.env, stdio: options.stdio });
  return new Promise((resolve3, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== null) {
        resolve3(code);
        return;
      }
      resolve3(signal === null ? 0 : 1);
    });
  });
}
if (isDirectInvocation(process.argv[1])) {
  runCodegraphServeCli().catch((error) => {
    processStderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}
`);
    process.exitCode = 1;
  });
}
function isDirectInvocation(argvPath) {
  if (argvPath === undefined)
    return false;
  const modulePath = fileURLToPath(import.meta.url);
  const moduleName = basename(modulePath);
  if (moduleName !== "serve.js" && moduleName !== "serve.ts")
    return false;
  return realpathSync(resolve2(argvPath)) === realpathSync(modulePath);
}
export {
  runCodegraphServeCli,
  runCodegraphServe
};
