#!/usr/bin/env node

// src/serve.ts
import { spawn } from "node:child_process";
import { existsSync as existsSync4, realpathSync } from "node:fs";
import { homedir as homedir4 } from "node:os";
import { basename, extname, join as join5, resolve as resolve2 } from "node:path";
import {
  cwd as processCwd,
  env as processEnv,
  execPath as processExecPath,
  stderr as processStderr
} from "node:process";
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

// ../../../../utils/src/codegraph/node-support.ts
var CODEGRAPH_MIN_NODE_MAJOR = 20;
var CODEGRAPH_BLOCKED_NODE_MAJOR = 25;
var CODEGRAPH_UNSAFE_NODE_ENV = "CODEGRAPH_ALLOW_UNSAFE_NODE";
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
function parseNodeMajor(version) {
  const normalized = version.startsWith("v") ? version.slice(1) : version;
  const major = Number.parseInt(normalized.split(".")[0] ?? "", 10);
  return Number.isNaN(major) ? 0 : major;
}

// ../../../../utils/src/codegraph/resolve.ts
import { existsSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname, join as join3 } from "node:path";
import { createRequire } from "node:module";

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
var CODEGRAPH_LEGACY_ENV_BIN = "CODEGRAPH_BIN";
var requireFromHere = createRequire(import.meta.url);
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
  const fileExists = options.fileExists ?? existsSync;
  const configuredBin = env[CODEGRAPH_ENV_BIN]?.trim() || env[CODEGRAPH_LEGACY_ENV_BIN]?.trim();
  if (configuredBin !== undefined && configuredBin.length > 0) {
    return { argsPrefix: [], command: configuredBin, exists: fileExists(configuredBin), source: "env" };
  }
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

// ../../../../../node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/scanner.js
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

// ../../../../../node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/string-intern.js
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

// ../../../../../node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/parser.js
var ParseOptions;
(function(ParseOptions2) {
  ParseOptions2.DEFAULT = {
    allowTrailingComma: false
  };
})(ParseOptions || (ParseOptions = {}));
function parse(text, errors = [], options = ParseOptions.DEFAULT) {
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
      const object = {};
      onValue(object);
      previousParents.push(currentParent);
      currentParent = object;
      currentProperty = null;
    },
    onObjectProperty: (name) => {
      currentProperty = name;
    },
    onObjectEnd: () => {
      currentParent = previousParents.pop();
    },
    onArrayBegin: () => {
      const array = [];
      onValue(array);
      previousParents.push(currentParent);
      currentParent = array;
      currentProperty = null;
    },
    onArrayEnd: () => {
      currentParent = previousParents.pop();
    },
    onLiteralValue: onValue,
    onError: (error, offset, length) => {
      errors.push({ error, offset, length });
    }
  };
  visit(text, visitor, options);
  return currentParent[0];
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

// ../../../../../node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/main.js
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
var parse2 = parse;
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

// ../../../../utils/src/jsonc-parser.ts
var pluginConfigFileDetectionCache = new Map;
function stripBom(content) {
  return content.charCodeAt(0) === 65279 ? content.slice(1) : content;
}
function parseJsoncSafe(content) {
  const errors = [];
  const data = parse2(stripBom(content), errors, {
    allowTrailingComma: true,
    disallowComments: false
  });
  return {
    data: errors.length > 0 ? null : data,
    errors: errors.map((e) => ({
      message: printParseErrorCode(e.error),
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
var WINDOWS_CMD_EXTENSIONS = new Set([".bat", ".cmd"]);
var WINDOWS_NODE_SCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"]);
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
  const nodeSupport = evaluateCodegraphNodeSupport({ env, nodeVersion: options.nodeVersion });
  if (!nodeSupport.supported) {
    (options.stderr ?? processStderr).write(buildCodegraphNodeSkipHint(nodeSupport));
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
  const candidate = join5(installDir, "bin", process.platform === "win32" ? "codegraph.cmd" : "codegraph");
  return existsSync4(candidate) ? candidate : null;
}
async function runCodegraphServeCli() {
  process.exitCode = await runCodegraphServe();
}
async function runChildProcess(command, args, options) {
  const invocation = resolveServeProcessInvocation(command, args);
  const child = spawn(invocation.command, invocation.args, { env: options.env, stdio: options.stdio });
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
  runCodegraphServe,
  resolveServeProcessInvocation
};
