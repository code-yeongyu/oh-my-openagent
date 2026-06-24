#!/usr/bin/env node

// components/codegraph/src/cli.ts
import { realpathSync as realpathSync3 } from "node:fs";
import { basename as basename5, resolve as resolve4 } from "node:path";
import { stderr as processStderr3 } from "node:process";
import { fileURLToPath as fileURLToPath3 } from "node:url";

// components/codegraph/src/hook.ts
import { spawn } from "node:child_process";
import { homedir as homedir9 } from "node:os";
import { cwd as processCwd2, env as processEnv2, stdin as processStdin, stdout as processStdout } from "node:process";
import { fileURLToPath } from "node:url";

// ../../utils/src/codegraph/guidance.ts
import { homedir as homedir2 } from "node:os";

// ../../utils/src/codegraph/workspace.ts
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
function sanitizeBase(value) {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-");
  return sanitized.length > 0 ? sanitized : "workspace";
}
function codegraphDataRoot(homeDir) {
  return join(homeDir, ".omo", "codegraph");
}
function workspaceStorageName(workspace) {
  const resolved = resolve(workspace);
  const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 16);
  return `${sanitizeBase(basename(resolved))}-${hash}`;
}
function resolveCodegraphWorkspacePaths(workspace, options = {}) {
  const resolvedWorkspace = resolve(workspace);
  const dataRoot = codegraphDataRoot(options.homeDir ?? homedir());
  return {
    dataDir: join(dataRoot, "projects", workspaceStorageName(resolvedWorkspace)),
    dataRoot,
    projectLink: join(resolvedWorkspace, ".codegraph")
  };
}
function fallbackResult(dataRoot, projectLink, reason) {
  return { dataDir: projectLink, dataRoot, linked: false, mode: "in-place-fallback", projectLink, reason };
}
function isSameFilesystem(workspace, dataRoot, override) {
  if (override !== undefined)
    return override;
  return statSync(workspace).dev === statSync(dataRoot).dev;
}
function ensureInPlaceFallback(projectLink) {
  if (!existsSync(projectLink))
    mkdirSync(projectLink, { recursive: true });
}
function prepareCodegraphWorkspace(workspace, options = {}) {
  const resolvedWorkspace = resolve(workspace);
  const { dataDir, dataRoot, projectLink } = resolveCodegraphWorkspacePaths(resolvedWorkspace, options);
  try {
    mkdirSync(dataDir, { recursive: true });
    if (existsSync(projectLink)) {
      const linkStat = lstatSync(projectLink);
      if (!linkStat.isSymbolicLink()) {
        return { dataDir: projectLink, dataRoot, linked: false, mode: "in-project", projectLink };
      }
      if (realpathSync(projectLink) === realpathSync(dataDir)) {
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
      return fallbackResult(dataRoot, projectLink, `${reason}; fallback failed: ${String(fallbackError)}`);
    }
    return fallbackResult(dataRoot, projectLink, reason);
  }
}
function ensureCodegraphGitignored(workspace) {
  const gitDir = join(workspace, ".git");
  if (!existsSync(gitDir))
    return false;
  const excludePath = join(gitDir, "info", "exclude");
  try {
    mkdirSync(join(gitDir, "info"), { recursive: true });
    const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
    if (existing.split(/\r?\n/).includes(".codegraph"))
      return true;
    appendFileSync(excludePath, `${existing.endsWith(`
`) || existing.length === 0 ? "" : `
`}.codegraph
`);
    return true;
  } catch (error) {
    if (error instanceof Error)
      return false;
    throw error;
  }
}

// ../../utils/src/codegraph/guidance.ts
var CODEGRAPH_UNINITIALIZED_PATTERN = /CodeGraph not initialized in ([\s\S]*?)\.\s*Run ['`]codegraph init['`] in that project first\./i;
var ANSI_ESCAPE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
var CODEGRAPH_STATUS_PROJECT_PATTERN = /^.*?\bProject:\s*(.+?)\s*$/im;
var CODEGRAPH_STATUS_UNINITIALIZED_PATTERN = /^.*?\bNot initialized\s*$/im;
var CODEGRAPH_INIT_HINT_PATTERN = /Run\s+["'`]codegraph init["'`]\s+(?:in that project first|to initialize)\.?/i;
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
    homeDir: options.homeDir ?? homedir2()
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
  if (!isRecord(value))
    return "";
  return Object.entries(value).map(([key, nested]) => `${key}: ${textFromUnknown(nested)}`).filter((line) => line.trim().length > 0).join(`
`);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// shared/src/config-loader.ts
import { homedir as homedir4 } from "node:os";

// ../../utils/src/omo-config/loader.ts
import { existsSync as existsSync3, readFileSync as readFileSync2 } from "node:fs";
import { homedir as homedir3 } from "node:os";

// ../../utils/src/deep-merge.ts
var DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
function isUnsafeObjectKey(key) {
  return DANGEROUS_KEYS.has(key);
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
}

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

// ../../../node_modules/.bun/jsonc-parser@3.3.1/node_modules/jsonc-parser/lib/esm/impl/parser.js
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

// ../../utils/src/jsonc-parser.ts
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

// ../../utils/src/omo-config.ts
var HARNESS_IDS = ["codex", "opencode", "omo"];
var SETTING_HARNESS_SUPPORT = {
  "codegraph.auto_provision": HARNESS_IDS,
  "codegraph.enabled": HARNESS_IDS,
  "codegraph.install_dir": HARNESS_IDS,
  "codegraph.telemetry": HARNESS_IDS,
  "codegraph.watch_debounce_ms": ["opencode", "omo"]
};

// ../../utils/src/omo-config/env-overrides.ts
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

// ../../utils/src/omo-config/resolve.ts
import { existsSync as existsSync2 } from "node:fs";
import { dirname, isAbsolute, join as join2, relative, resolve as resolve2 } from "node:path";
function containsPath(parent, child) {
  const pathToChild = relative(parent, child);
  return pathToChild === "" || !pathToChild.startsWith("..") && !isAbsolute(pathToChild);
}
function findProjectConfigPathsNearestFirst(cwd, homeDir) {
  const startDir = resolve2(cwd);
  const stopBeforeDir = containsPath(resolve2(homeDir), startDir) ? resolve2(homeDir) : null;
  const paths = [];
  let currentDir = startDir;
  while (true) {
    if (stopBeforeDir !== null && currentDir === stopBeforeDir)
      break;
    const configPath = join2(currentDir, ".omo", "config.jsonc");
    if (existsSync2(configPath)) {
      paths.push(configPath);
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir)
      break;
    currentDir = parentDir;
  }
  return paths;
}
function resolveOmoConfigPaths(options) {
  const globalPath = join2(resolve2(options.homeDir), ".omo", "config.jsonc");
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

// ../../utils/src/omo-config/loader.ts
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
function isRecord2(value) {
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
  if (!isRecord2(merged))
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
  if (!isRecord2(section)) {
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
  if (!isRecord2(value)) {
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
  if (!isRecord2(value))
    return {};
  const blockKey = `[${harness}]`;
  if (!hasOwn(value, blockKey))
    return {};
  return normalizeConfigBody(value[blockKey], `${pathPrefix}.${blockKey}`, warnings);
}
function loadConfigFile(path, harness) {
  try {
    const content = readFileSync2(path, "utf-8");
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

// shared/src/config-loader.ts
function getCodexOmoConfig(options = {}) {
  const env = options.env ?? process.env;
  const homeDir = resolveHomeDir(options);
  const result = loadOmoConfig({
    ...options.cwd === undefined ? {} : { cwd: options.cwd },
    env,
    homeDir,
    harness: "codex"
  });
  const trustedConfig = loadOmoConfig({
    cwd: homeDir,
    env,
    homeDir,
    harness: "codex"
  });
  const trustedCodegraphInstallDir = trustedConfig.config.codegraph?.install_dir;
  return {
    ...result.config,
    sources: result.sources,
    ...trustedCodegraphInstallDir === undefined ? {} : { trustedCodegraphInstallDir },
    warnings: result.warnings
  };
}
function resolveHomeDir(options) {
  const env = options.env ?? process.env;
  return options.homeDir ?? env["HOME"] ?? env["USERPROFILE"] ?? homedir4();
}

// components/codegraph/src/session-start-worker.ts
import { execFile as execFile2 } from "node:child_process";
import { appendFileSync as appendFileSync2, existsSync as existsSync6, mkdirSync as mkdirSync2 } from "node:fs";
import { homedir as homedir8 } from "node:os";
import { extname, join as join7 } from "node:path";
import { cwd as processCwd, env as processEnv, stderr as processStderr } from "node:process";

// ../../utils/src/codegraph/env.ts
import { homedir as homedir5 } from "node:os";
import { join as join3 } from "node:path";
var CODEGRAPH_INSTALL_DIR_ENV = "CODEGRAPH_INSTALL_DIR";
var CODEGRAPH_NO_DOWNLOAD_ENV = "CODEGRAPH_NO_DOWNLOAD";
var CODEGRAPH_TELEMETRY_ENV = "CODEGRAPH_TELEMETRY";
var DO_NOT_TRACK_ENV = "DO_NOT_TRACK";
function buildCodegraphEnv(options = {}) {
  const homeDir = options.homeDir ?? homedir5();
  return {
    [CODEGRAPH_INSTALL_DIR_ENV]: join3(homeDir, ".omo", "codegraph"),
    [CODEGRAPH_NO_DOWNLOAD_ENV]: "1",
    [CODEGRAPH_TELEMETRY_ENV]: "0",
    [DO_NOT_TRACK_ENV]: "1"
  };
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
function parseNodeMajor(version) {
  const normalized = version.startsWith("v") ? version.slice(1) : version;
  const major = Number.parseInt(normalized.split(".")[0] ?? "", 10);
  return Number.isNaN(major) ? 0 : major;
}

// ../../utils/src/codegraph/provision.ts
import { createHash as createHash2, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { existsSync as existsSync4 } from "node:fs";
import { homedir as homedir6, hostname } from "node:os";
import { basename as basename2, join as join4 } from "node:path";
import { promisify } from "node:util";

// ../../utils/src/codegraph/manifest.ts
var CODEGRAPH_PROVISION_MANIFEST = {
  assets: {
    "darwin-arm64": {
      executableName: "codegraph",
      sha256: "95bb27bf6382b69659e158e0c04d71cc394778951e1317d582be7807e7866908",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.0.1/codegraph-darwin-arm64.tar.gz"
    },
    "darwin-x64": {
      executableName: "codegraph",
      sha256: "3311cc1d1f0f0ad742709b6a43d8a9187b1ef0af0dd30e0b58008dc673e29478",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.0.1/codegraph-darwin-x64.tar.gz"
    },
    "linux-arm64": {
      executableName: "codegraph",
      sha256: "e16f612bc96c2ebccd04574cbed500c9939147c80666ad6bb024398dff7992ae",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.0.1/codegraph-linux-arm64.tar.gz"
    },
    "linux-x64": {
      executableName: "codegraph",
      sha256: "d45a068f44596a85c7ba7d0ef924eaf7103fbbf3cafbeb668127daff60a52228",
      url: "https://github.com/colbymchenry/codegraph/releases/download/v1.0.1/codegraph-linux-x64.tar.gz"
    },
    "win32-arm64": {
      executableName: "codegraph.cmd",
      sha256: "8d57ced73b24d35f758f2ede2318e80e1d7241987f37a999e3d80edb6fddf961",
      url: "https://registry.npmjs.org/@colbymchenry/codegraph-win32-arm64/-/codegraph-win32-arm64-1.0.1.tgz"
    },
    "win32-x64": {
      executableName: "codegraph.cmd",
      sha256: "52607fe73b05e741fd1087da2ceca9d3c8f565e36bf1a7070600bdbdf3931e32",
      url: "https://registry.npmjs.org/@colbymchenry/codegraph-win32-x64/-/codegraph-win32-x64-1.0.1.tgz"
    }
  },
  version: "1.0.1"
};

// ../../utils/src/codegraph/provision.ts
var DEFAULT_LOCK_WAIT_MS = 5000;
var DEFAULT_LOCK_STALE_MS = 120000;
var DEFAULT_DOWNLOAD_TIMEOUT_MS = 60000;
var execFileAsync = promisify(execFile);
function platformKey() {
  return `${process.platform}-${process.arch}`;
}
function markerPath(installDir, version) {
  return join4(installDir, ".provisioned", `codegraph-${version}.json`);
}
function defaultInstallDir() {
  return join4(homedir6(), ".omo", "codegraph");
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
  return new Promise((resolve3) => setTimeout(resolve3, ms));
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
    installDir: options.installDir ?? join4(options.lockDir, "codegraph-force-bad-checksum"),
    manifest: {
      assets: {
        [key]: { executableName: process.platform === "win32" ? "codegraph.cmd" : "codegraph", sha256: "0000", url: "memory://bad" }
      },
      version: options.version
    },
    platformKey: key
  };
}
async function readMarker(path) {
  if (!existsSync4(path))
    return null;
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    if (typeof raw === "object" && raw !== null && "binPath" in raw) {
      const value = raw.binPath;
      return typeof value === "string" && existsSync4(value) ? value : null;
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
  await mkdir(join4(lockPath, ".."), { recursive: true });
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
  const bundleDir = join4(extractDir, roots[0] ?? "");
  const bundleEntries = await readdir(bundleDir);
  await mkdir(installDir, { recursive: true });
  for (const entry of bundleEntries) {
    await rm(join4(installDir, entry), { force: true, recursive: true });
    await rename(join4(bundleDir, entry), join4(installDir, entry));
  }
  const destination = join4(installDir, "bin", executableName);
  if (!existsSync4(destination))
    throw new Error(`CodeGraph archive did not contain bin/${executableName}`);
  await chmod(destination, 493);
  return destination;
}
async function installAsset(layout) {
  const { asset, downloader, installDir, version } = layout;
  const stagingDir = join4(installDir, ".staging", randomUUID());
  const archivePath = join4(stagingDir, basename2(asset.url));
  const extractDir = join4(stagingDir, "extract");
  try {
    await mkdir(extractDir, { recursive: true });
    const bytes = await downloader(asset);
    const actualChecksum = sha256(bytes);
    if (actualChecksum !== asset.sha256) {
      throw new Error(`checksum mismatch for ${basename2(asset.url)}: expected ${asset.sha256}, got ${actualChecksum}`);
    }
    if (!asset.url.endsWith(".tar.gz") && !asset.url.endsWith(".tgz")) {
      throw new Error(`unsupported CodeGraph archive type for ${basename2(asset.url)}`);
    }
    await writeFile(archivePath, bytes);
    await extractTarGz(archivePath, extractDir);
    const destination = await installExtractedBundle(extractDir, installDir, asset.executableName);
    await mkdir(join4(installDir, ".provisioned"), { recursive: true });
    await writeFile(markerPath(installDir, version), `${JSON.stringify({ binPath: destination, version })}
`);
    return destination;
  } finally {
    await rm(stagingDir, { force: true, recursive: true });
    await removeEmptyDirectory(join4(installDir, ".staging"));
  }
}
async function ensureCodegraphProvisioned(options) {
  const forced = forcedBadChecksumOptions(options);
  const installDir = forced?.installDir ?? options.installDir ?? defaultInstallDir();
  const manifest = forced?.manifest ?? options.manifest ?? CODEGRAPH_PROVISION_MANIFEST;
  const activePlatformKey = forced?.platformKey ?? options.platformKey ?? platformKey();
  const downloader = forced?.downloader ?? options.downloader ?? ((asset) => defaultDownloader(asset, options.downloadTimeoutMs));
  const marker = markerPath(installDir, options.version);
  const existing = await readMarker(marker);
  if (existing !== null)
    return { binPath: existing, provisioned: true };
  const lockPath = join4(options.lockDir, `codegraph-${hostname()}.lock`);
  const release = await acquireLock(lockPath, options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS, options.lockStaleMs ?? DEFAULT_LOCK_STALE_MS);
  if (release === null)
    return { error: "timed out waiting for codegraph provisioning lock", provisioned: false };
  try {
    const lockedExisting = await readMarker(marker);
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
import { existsSync as existsSync5 } from "node:fs";
import { homedir as homedir7 } from "node:os";
import { spawnSync } from "node:child_process";
import { basename as basename3, dirname as dirname2, join as join6 } from "node:path";
import { createRequire } from "node:module";

// ../../utils/src/runtime/which.ts
import { accessSync, constants } from "node:fs";
import { delimiter, join as join5 } from "node:path";
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
      const candidatePath = join5(pathEntry, candidateName);
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
    const version = `${result.stdout}
${result.stderr}`.trim().split(/\s+/)[0];
    return version === undefined || version.length === 0 ? null : version;
  } catch (error) {
    if (error instanceof Error)
      return null;
    throw error;
  }
}
function isNodeExecutableName(filePath) {
  const executable = basename3(filePath).toLowerCase();
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
  const version = nodeVersion(nodePath);
  if (version === null)
    return false;
  return evaluateCodegraphNodeSupport({ env, nodeVersion: version }).supported;
}
function defaultNodeRuntime(env, fileExists, which, nodeVersion) {
  const configured = env[CODEGRAPH_NODE_BIN_ENV]?.trim();
  if (configured !== undefined && configured.length > 0) {
    const resolved = resolveConfiguredNodeRuntime(configured, fileExists, which);
    return resolved !== null && supportsCodegraphNodeRuntime(resolved, env, nodeVersion) ? resolved : null;
  }
  const candidates = [
    ...isNodeExecutableName(process.execPath) ? [process.execPath] : [],
    ...CODEGRAPH_NODE_CANDIDATES.map((commandName) => which(commandName)).filter((candidate) => candidate !== null)
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
  const binaryName = process.platform === "win32" ? "codegraph.cmd" : "codegraph";
  const candidates = [
    join6(homeDir, ".omo", "codegraph", "bin", binaryName),
    join6(homeDir, ".omo", "codegraph", "node-servers", "node_modules", ".bin", binaryName)
  ];
  return candidates.find((candidate) => fileExists(candidate)) ?? null;
}
function resolveBundledShim(requireResolve, fileExists) {
  try {
    const packageJson = requireResolve(`${CODEGRAPH_PACKAGE}/package.json`);
    const packageRoot = dirname2(packageJson);
    const candidates = [join6(packageRoot, "bin", "codegraph.js"), join6(packageRoot, "npm-shim.js")];
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
  const fileExists = options.fileExists ?? existsSync5;
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
  const provisioned = options.provisioned?.() ?? defaultProvisionedBin(options.homeDir ?? homedir7(), fileExists);
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

// components/codegraph/src/session-start-worker.ts
var SESSION_START_CWD_ENV = "OMO_CODEGRAPH_SESSION_START_CWD";
var CODEGRAPH_VERSION = "1.0.1";
var COMMAND_TIMEOUT_MS = 60000;
var WINDOWS_CMD_EXTENSIONS = new Set([".bat", ".cmd"]);
var defaultDeps = {
  ensureGitignored: ensureCodegraphGitignored,
  ensureProvisioned: ensureCodegraphProvisioned,
  prepareWorkspace: prepareCodegraphWorkspace,
  resolveCommand: resolveCodegraphCommand,
  runCommand: runCodegraphCommand
};
async function runCodegraphSessionStartWorker(options = {}) {
  const env = options.env ?? processEnv;
  const homeDir = resolveHomeDir2(env);
  const projectRoot = options.cwd ?? env[SESSION_START_CWD_ENV] ?? processCwd();
  const config = options.config ?? getCodexOmoConfig({ cwd: projectRoot, env, homeDir });
  const logOutcome = options.logOutcome ?? ((outcome) => appendOutcome(homeDir, outcome));
  if (config.codegraph?.enabled === false) {
    return finish("skipped-disabled", { projectRoot }, logOutcome);
  }
  const nodeSupport = evaluateCodegraphNodeSupport({ env, nodeVersion: options.nodeVersion });
  const bootstrapConfig = {
    ...config.codegraph ?? {},
    ...config.trustedCodegraphInstallDir === undefined ? {} : { trustedCodegraphInstallDir: config.trustedCodegraphInstallDir }
  };
  return runBootstrap(projectRoot, bootstrapConfig, env, homeDir, nodeSupport, { ...defaultDeps, ...options.deps }, logOutcome);
}
async function runBootstrap(projectRoot, config, env, homeDir, nodeSupport, deps, logOutcome) {
  try {
    const command = await resolveOrProvisionCommand(deps, config, env, homeDir, nodeSupport);
    if (command.kind === "unavailable") {
      return finish("skipped-unavailable", { error: command.error, projectRoot, source: command.source }, logOutcome);
    }
    if (command.kind === "unsupported-node") {
      return finish("skipped-unsupported-node", { projectRoot }, logOutcome);
    }
    deps.prepareWorkspace(projectRoot, { homeDir });
    deps.ensureGitignored(projectRoot);
    const codegraphEnv = codegraphEnvForConfig(config, homeDir);
    const status = await deps.runCommand(projectRoot, command.resolution.command, [...command.resolution.argsPrefix, "status", "--json"], { env: codegraphEnv, timeoutMs: COMMAND_TIMEOUT_MS });
    const decision = decideStartupAction(status);
    if (decision.kind === "skip")
      return finish("skipped-status", { error: decision.reason, projectRoot }, logOutcome);
    const actionArgs = command.resolution.argsPrefix.concat(decision.kind === "init" ? ["init"] : ["sync"]);
    const action = await deps.runCommand(projectRoot, command.resolution.command, actionArgs, { env: codegraphEnv, timeoutMs: COMMAND_TIMEOUT_MS });
    return finish(decision.kind === "init" ? "initialized" : "synced", { exitCode: action.exitCode, projectRoot, source: command.resolution.source, timedOut: action.timedOut }, logOutcome);
  } catch (error) {
    return finish("failed", { error: error instanceof Error ? error.message : String(error), projectRoot }, logOutcome);
  }
}
function finish(action, detail, logOutcome) {
  safeLogOutcome(logOutcome, { ...detail, action });
  return { action };
}
async function resolveOrProvisionCommand(deps, config, env, homeDir, nodeSupport) {
  const trustedInstallDir = config.trustedCodegraphInstallDir;
  const resolved = deps.resolveCommand({ env, homeDir, provisioned: () => provisionedBinFromInstallDir(trustedInstallDir) });
  if (resolved.exists && canUseResolvedCommand(resolved, nodeSupport)) {
    return { kind: "resolved", resolution: resolved };
  }
  if (resolved.exists && config.auto_provision === false)
    return { kind: "unsupported-node" };
  if (config.auto_provision === false)
    return { error: "codegraph binary unavailable and auto_provision is disabled", kind: "unavailable", source: resolved.source };
  const installDir = trustedInstallDir ?? join7(homeDir, ".omo", "codegraph");
  const provisioned = await deps.ensureProvisioned({ installDir, lockDir: join7(installDir, ".locks"), version: CODEGRAPH_VERSION });
  if (!provisioned.provisioned || provisioned.binPath === undefined) {
    return { error: provisioned.error ?? "provisioning did not produce a binary", kind: "unavailable", source: resolved.source };
  }
  return { kind: "resolved", resolution: { argsPrefix: [], command: provisioned.binPath, exists: true, source: "provisioned" } };
}
function codegraphEnvForConfig(config, homeDir) {
  const env = buildCodegraphEnv({ homeDir });
  return config.trustedCodegraphInstallDir === undefined ? env : { ...env, CODEGRAPH_INSTALL_DIR: config.trustedCodegraphInstallDir };
}
function canUseResolvedCommand(resolved, nodeSupport) {
  return !codegraphCommandRequiresSupportedLocalNode(resolved) || nodeSupport.supported;
}
function decideStartupAction(status) {
  if (status.timedOut)
    return { kind: "skip", reason: "status timed out" };
  const text = `${status.stdout}
${status.stderr ?? ""}`.toLowerCase();
  if (text.includes("not initialized") || text.includes("uninitialized"))
    return { kind: "init" };
  const initialized = jsonSaysInitialized(parseJson(status.stdout));
  if (initialized === false)
    return { kind: "init" };
  if (initialized === true)
    return { kind: "sync" };
  if (status.exitCode !== 0)
    return { kind: "skip", reason: `status exited ${status.exitCode}` };
  return { kind: "sync" };
}
function jsonSaysInitialized(value) {
  if (!isRecord3(value))
    return;
  const initialized = value["initialized"] ?? value["isInitialized"] ?? value["ready"];
  if (typeof initialized === "boolean")
    return initialized;
  const status = value["status"];
  if (typeof status !== "string")
    return;
  const normalized = status.toLowerCase();
  if (normalized.includes("not initialized") || normalized.includes("uninitialized"))
    return false;
  if (normalized.includes("initialized") || normalized.includes("ready"))
    return true;
  return;
}
async function runCodegraphCommand(projectRoot, command, args, options) {
  const invocation = resolveCodegraphCommandInvocation(command, args);
  return new Promise((resolvePromise) => {
    execFile2(invocation.command, [...invocation.args], { cwd: projectRoot, encoding: "utf8", env: { ...process.env, ...options.env }, maxBuffer: 1024 * 1024, timeout: options.timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error === null) {
        resolvePromise({ exitCode: 0, stderr: toOutputText(stderr), stdout: toOutputText(stdout), timedOut: false });
        return;
      }
      resolvePromise({ exitCode: resolveExitCode(error), stderr: toOutputText(stderr), stdout: toOutputText(stdout), timedOut: error.killed === true });
    });
  });
}
function resolveCodegraphCommandInvocation(command, args, platform = process.platform) {
  if (platform !== "win32")
    return { args: [...args], command };
  if (!WINDOWS_CMD_EXTENSIONS.has(extname(command).toLowerCase()))
    return { args: [...args], command };
  return { args: ["/d", "/s", "/c", command, ...args], command: "cmd.exe" };
}
function appendOutcome(homeDir, outcome) {
  const logDir = join7(homeDir, ".omo", "codegraph");
  mkdirSync2(logDir, { recursive: true });
  appendFileSync2(join7(logDir, "session-start.jsonl"), `${JSON.stringify({ ...outcome, timestamp: new Date().toISOString() })}
`);
}
function safeLogOutcome(logOutcome, outcome) {
  try {
    logOutcome(outcome);
  } catch (error) {
    if (error instanceof Error)
      processStderr.write(`[codegraph-session-start] failed to write outcome: ${error.message}
`);
    else
      throw error;
  }
}
function provisionedBinFromInstallDir(installDir) {
  if (installDir === undefined)
    return null;
  const candidate = join7(installDir, "bin", process.platform === "win32" ? "codegraph.cmd" : "codegraph");
  return existsSync6(candidate) ? candidate : null;
}
function resolveExitCode(error) {
  if ("code" in error && typeof error.code === "number")
    return error.code;
  return 1;
}
function toOutputText(value) {
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}
function resolveHomeDir2(env) {
  return env["HOME"] ?? env["USERPROFILE"] ?? homedir8();
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
function isRecord3(value) {
  return typeof value === "object" && value !== null;
}

// components/codegraph/src/hook.ts
var CODEGRAPH_SESSION_START_NOTICE = "LazyCodex CodeGraph bootstrap scheduled in background";
async function runCodegraphSessionStartHook(options = {}) {
  return (await executeCodegraphSessionStartHook(options)).exitCode;
}
async function runCodegraphPostToolUseHookCli(options = {}) {
  return (await executeCodegraphPostToolUseHook(options)).exitCode;
}
async function executeCodegraphSessionStartHook(options = {}) {
  const env = options.env ?? processEnv2;
  const input = await readHookInput(options.stdin ?? processStdin);
  const projectRoot = resolveProjectRoot(input, options.cwd ?? processCwd2());
  const homeDir = resolveHomeDir3(env);
  const config = options.config ?? getCodexOmoConfig({ cwd: projectRoot, env, homeDir });
  if (config.codegraph?.enabled === false) {
    return { action: "skipped-disabled", exitCode: 0 };
  }
  (options.spawnWorker ?? spawnDetachedWorker)({
    args: [options.workerCliPath ?? defaultWorkerCliPath(), "hook", "session-start-worker"],
    command: process.execPath,
    env: { ...env, [SESSION_START_CWD_ENV]: projectRoot }
  });
  writeHookJson(options.stdout ?? processStdout);
  return { action: "spawned", exitCode: 0 };
}
async function executeCodegraphPostToolUseHook(options = {}) {
  const env = options.env ?? processEnv2;
  const input = await readHookInput(options.stdin ?? processStdin);
  const output = runCodegraphPostToolUseHook(input, { homeDir: resolveHomeDir3(env) });
  if (output.length === 0)
    return { action: "skipped", exitCode: 0 };
  (options.stdout ?? processStdout).write(output);
  return { action: "emitted-guidance", exitCode: 0 };
}
function runCodegraphPostToolUseHook(input, options = {}) {
  const toolName = isRecord4(input) ? input["tool_name"] : undefined;
  const cwd = isRecord4(input) ? input["cwd"] : undefined;
  const toolOutput = isRecord4(input) ? input["tool_response"] ?? input["tool_output"] ?? input["response"] : input;
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
function writeHookJson(stdout) {
  const output = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: CODEGRAPH_SESSION_START_NOTICE
    }
  };
  stdout.write(`${JSON.stringify(output)}
`);
}
function spawnDetachedWorker(invocation) {
  const child = spawn(invocation.command, [...invocation.args], { detached: true, env: invocation.env, stdio: "ignore" });
  child.unref();
}
function resolveHomeDir3(env) {
  return env["HOME"] ?? env["USERPROFILE"] ?? homedir9();
}
function resolveProjectRoot(input, fallback) {
  if (!isRecord4(input))
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
  return parseJson2(text);
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
function isRecord4(value) {
  return typeof value === "object" && value !== null;
}
function defaultWorkerCliPath() {
  return fileURLToPath(import.meta.url);
}

// components/codegraph/src/serve.ts
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync7, realpathSync as realpathSync2 } from "node:fs";
import { homedir as homedir10 } from "node:os";
import { basename as basename4, extname as extname2, join as join8, resolve as resolve3 } from "node:path";
import {
  cwd as processCwd3,
  env as processEnv3,
  execPath as processExecPath,
  stdin as processStdin2,
  stderr as processStderr2,
  stdout as processStdout2
} from "node:process";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// ../../mcp-stdio-core/src/record.ts
function isPlainRecord(value) {
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
function writeStdioJsonRpcResponse(output, response, responseMode) {
  const body = JSON.stringify(response);
  if (responseMode === "framed") {
    output.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r
\r
${body}`);
    return;
  }
  output.write(`${body}
`);
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
var noopLog = () => {};
async function runJsonRpcStdioServer(config) {
  const log = config.log ?? noopLog;
  const idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const idleTimer = createIdleTimer(idleTimeoutMs, log, config.onIdleTimeout);
  log("stdio_started", { cwd: process.cwd(), idle_timeout_ms: idleTimeoutMs });
  idleTimer.arm();
  try {
    for await (const message of readStdioJsonRpcMessages(config.input)) {
      if (idleTimer.closed())
        break;
      idleTimer.arm();
      if (message.kind === "parse_error") {
        handleParseError(message, config, log);
        continue;
      }
      await handleRequest(message, config, log);
    }
  } finally {
    idleTimer.clear();
    log("stdio_stopped");
  }
}
function handleParseError(message, config, log) {
  log("parse_error", { message: message.message });
  const response = config.parseErrorResponse?.(message.message) ?? errorResponse(null, -32700, "Parse error", message.message);
  if (response !== undefined) {
    writeStdioJsonRpcResponse(config.output, response, message.responseMode);
  }
}
async function handleRequest(message, config, log) {
  const parsed = message.payload;
  const id = isPlainRecord(parsed) ? jsonRpcId(parsed["id"]) : null;
  const method = isPlainRecord(parsed) && typeof parsed["method"] === "string" ? parsed["method"] : null;
  log("request", { id: id === null ? null : String(id), method });
  try {
    const response = await config.handler(parsed, config.handlerOptions);
    if (response === undefined)
      return;
    writeStdioJsonRpcResponse(config.output, response, message.responseMode);
    log("response", { id: String(response.id), method, is_error: response.error !== undefined });
  } catch (error) {
    if (config.onHandlerError === undefined)
      throw error;
    config.onHandlerError(error);
  }
}
function createIdleTimer(idleTimeoutMs, log, onIdleTimeout) {
  let timer = null;
  let isClosed = false;
  return {
    arm: () => {
      if (timer !== null)
        clearTimeout(timer);
      if (idleTimeoutMs <= 0)
        return;
      timer = setTimeout(() => {
        isClosed = true;
        log("idle_timeout", { idle_timeout_ms: idleTimeoutMs });
        onIdleTimeout?.();
      }, idleTimeoutMs);
      timer.unref();
    },
    clear: () => {
      if (timer === null)
        return;
      clearTimeout(timer);
      timer = null;
    },
    closed: () => isClosed
  };
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
    output: options.output
  });
}
async function handleUnavailableCodegraphMcpRequest(input, options) {
  if (!isPlainRecord(input)) {
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
  if (!isPlainRecord(params) || typeof params["protocolVersion"] !== "string")
    return "2024-11-05";
  return params["protocolVersion"];
}

// components/codegraph/src/serve.ts
var CODEGRAPH_SKIP_HINT = `CodeGraph MCP skipped: codegraph binary not found. Install CodeGraph or set OMO_CODEGRAPH_BIN.
`;
var CODEGRAPH_DISABLED_HINT = `CodeGraph MCP skipped: disabled by OMO SOT config. Set [codex].codegraph.enabled=true to enable it.
`;
var CODEGRAPH_VERSION2 = "1.0.1";
var WINDOWS_CMD_EXTENSIONS2 = new Set([".bat", ".cmd"]);
var WINDOWS_NODE_SCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"]);
async function runCodegraphServe(options = {}) {
  const env = options.env ?? processEnv3;
  const homeDir = options.homeDir ?? homedir10();
  const config = options.config ?? getCodexOmoConfig({ cwd: options.cwd ?? processCwd3(), env, homeDir });
  const codegraphConfig = config.codegraph ?? {};
  if (codegraphConfig.enabled === false) {
    return runUnavailableMcp(CODEGRAPH_DISABLED_HINT, options);
  }
  const trustedInstallDir = config.trustedCodegraphInstallDir;
  const resolutionOptions = {
    env,
    homeDir,
    provisioned: () => provisionedBinFromInstallDir2(trustedInstallDir)
  };
  let resolution = options.resolve?.(resolutionOptions) ?? resolveCodegraphCommand(resolutionOptions);
  const nodeSupport = evaluateCodegraphNodeSupport({ env, nodeVersion: options.nodeVersion });
  if (!resolution.exists || shouldSkipResolvedCommand(resolution, options.commandExists ?? existsSync7)) {
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
  const runProcess = options.runProcess ?? runChildProcess;
  const codegraphEnv = codegraphEnvForConfig2(trustedInstallDir, homeDir, options.buildEnv);
  const mergedEnv = {
    ...env,
    ...codegraphEnv
  };
  return runProcess(resolution.command, [...resolution.argsPrefix, "serve", "--mcp"], {
    env: mergedEnv,
    stdio: "inherit"
  });
}
async function runUnavailableMcp(reason, options) {
  (options.stderr ?? processStderr2).write(reason);
  await runUnavailableCodegraphMcpServer({
    input: options.stdin ?? processStdin2,
    output: options.stdout ?? processStdout2,
    reason,
    serverVersion: CODEGRAPH_VERSION2
  });
  return 0;
}
async function provisionMissingCodegraph(options) {
  if (options.resolution.source === "env")
    return null;
  if (options.config.auto_provision === false)
    return null;
  const installDir = options.trustedInstallDir ?? join8(options.homeDir, ".omo", "codegraph");
  const result = await options.ensureProvisioned({
    installDir,
    lockDir: join8(installDir, ".locks"),
    version: CODEGRAPH_VERSION2
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
function codegraphEnvForConfig2(trustedInstallDir, homeDir, buildEnv) {
  const env = buildEnv?.({ homeDir }) ?? buildCodegraphEnv({ homeDir });
  return trustedInstallDir === undefined ? env : { ...env, CODEGRAPH_INSTALL_DIR: trustedInstallDir };
}
function provisionedBinFromInstallDir2(installDir) {
  if (installDir === undefined)
    return null;
  const candidate = join8(installDir, "bin", process.platform === "win32" ? "codegraph.cmd" : "codegraph");
  return existsSync7(candidate) ? candidate : null;
}
async function runCodegraphServeCli() {
  process.exitCode = await runCodegraphServe();
}
async function runChildProcess(command, args, options) {
  const invocation = resolveServeProcessInvocation(command, args);
  const child = spawn2(invocation.command, invocation.args, { env: options.env, stdio: options.stdio });
  return new Promise((resolve4, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== null) {
        resolve4(code);
        return;
      }
      resolve4(signal === null ? 0 : 1);
    });
  });
}
function resolveServeProcessInvocation(command, args, platform = process.platform) {
  if (platform !== "win32")
    return { args: [...args], command };
  const extension = extname2(command).toLowerCase();
  if (WINDOWS_NODE_SCRIPT_EXTENSIONS.has(extension)) {
    return { args: [command, ...args], command: processExecPath };
  }
  if (WINDOWS_CMD_EXTENSIONS2.has(extension)) {
    return { args: ["/d", "/s", "/c", command, ...args], command: "cmd.exe" };
  }
  return { args: [...args], command };
}
if (isDirectInvocation(process.argv[1])) {
  runCodegraphServeCli().catch((error) => {
    processStderr2.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}
`);
    process.exitCode = 1;
  });
}
function isDirectInvocation(argvPath) {
  if (argvPath === undefined)
    return false;
  const modulePath = fileURLToPath2(import.meta.url);
  const moduleName = basename4(modulePath);
  if (moduleName !== "serve.js" && moduleName !== "serve.ts")
    return false;
  return realpathSync2(resolve3(argvPath)) === realpathSync2(modulePath);
}

// components/codegraph/src/cli.ts
async function runCodegraphCli(options = {}) {
  const argv = options.argv ?? process.argv;
  const command = argv[2];
  const subcommand = argv[3];
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
    processStderr3.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}
`);
    process.exitCode = 1;
  });
}
function isDirectInvocation2(argvPath) {
  if (argvPath === undefined)
    return false;
  const modulePath = fileURLToPath3(import.meta.url);
  const moduleName = basename5(modulePath);
  if (moduleName !== "cli.js" && moduleName !== "cli.ts")
    return false;
  return realpathSync3(resolve4(argvPath)) === realpathSync3(modulePath);
}
export {
  runCodegraphCli
};
