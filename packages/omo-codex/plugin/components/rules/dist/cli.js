#!/usr/bin/env node
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

// ../../../node_modules/.bun/picomatch@4.0.7/node_modules/picomatch/lib/constants.js
var require_constants = __commonJS((exports, module) => {
  var WIN_SLASH = "\\\\/";
  var WIN_NO_SLASH = `[^${WIN_SLASH}]`;
  var DEFAULT_MAX_EXTGLOB_RECURSION = 0;
  var DOT_LITERAL = "\\.";
  var PLUS_LITERAL = "\\+";
  var QMARK_LITERAL = "\\?";
  var SLASH_LITERAL = "\\/";
  var ONE_CHAR = "(?=.)";
  var QMARK = "[^/]";
  var END_ANCHOR = `(?:${SLASH_LITERAL}|$)`;
  var START_ANCHOR = `(?:^|${SLASH_LITERAL})`;
  var DOTS_SLASH = `${DOT_LITERAL}{1,2}${END_ANCHOR}`;
  var NO_DOT = `(?!${DOT_LITERAL})`;
  var NO_DOTS = `(?!${START_ANCHOR}${DOTS_SLASH})`;
  var NO_DOT_SLASH = `(?!${DOT_LITERAL}{0,1}${END_ANCHOR})`;
  var NO_DOTS_SLASH = `(?!${DOTS_SLASH})`;
  var QMARK_NO_DOT = `[^.${SLASH_LITERAL}]`;
  var STAR = `${QMARK}*?`;
  var SEP = "/";
  var POSIX_CHARS = {
    DOT_LITERAL,
    PLUS_LITERAL,
    QMARK_LITERAL,
    SLASH_LITERAL,
    ONE_CHAR,
    QMARK,
    END_ANCHOR,
    DOTS_SLASH,
    NO_DOT,
    NO_DOTS,
    NO_DOT_SLASH,
    NO_DOTS_SLASH,
    QMARK_NO_DOT,
    STAR,
    START_ANCHOR,
    SEP
  };
  var WINDOWS_CHARS = {
    ...POSIX_CHARS,
    SLASH_LITERAL: `[${WIN_SLASH}]`,
    QMARK: WIN_NO_SLASH,
    STAR: `${WIN_NO_SLASH}*?`,
    DOTS_SLASH: `${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$)`,
    NO_DOT: `(?!${DOT_LITERAL})`,
    NO_DOTS: `(?!(?:^|[${WIN_SLASH}])${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
    NO_DOT_SLASH: `(?!${DOT_LITERAL}{0,1}(?:[${WIN_SLASH}]|$))`,
    NO_DOTS_SLASH: `(?!${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
    QMARK_NO_DOT: `[^.${WIN_SLASH}]`,
    START_ANCHOR: `(?:^|[${WIN_SLASH}])`,
    END_ANCHOR: `(?:[${WIN_SLASH}]|$)`,
    SEP: "\\"
  };
  var POSIX_REGEX_SOURCE = {
    __proto__: null,
    alnum: "a-zA-Z0-9",
    alpha: "a-zA-Z",
    ascii: "\\x00-\\x7F",
    blank: " \\t",
    cntrl: "\\x00-\\x1F\\x7F",
    digit: "0-9",
    graph: "\\x21-\\x7E",
    lower: "a-z",
    print: "\\x20-\\x7E ",
    punct: "\\-!\"#$%&'()\\*+,./:;<=>?@[\\]^_`{|}~",
    space: " \\t\\r\\n\\v\\f",
    upper: "A-Z",
    word: "A-Za-z0-9_",
    xdigit: "A-Fa-f0-9"
  };
  module.exports = {
    DEFAULT_MAX_EXTGLOB_RECURSION,
    MAX_LENGTH: 1024 * 64,
    POSIX_REGEX_SOURCE,
    REGEX_BACKSLASH: /\\(?![*+?^${}(|)[\]])/g,
    REGEX_NON_SPECIAL_CHARS: /^[^@![\].,$*+?^{}()|\\/]+/,
    REGEX_SPECIAL_CHARS: /[-*+?.^${}(|)[\]]/,
    REGEX_SPECIAL_CHARS_BACKREF: /(\\?)((\W)(\3*))/g,
    REGEX_SPECIAL_CHARS_GLOBAL: /([-*+?.^${}(|)[\]])/g,
    REGEX_REMOVE_BACKSLASH: /(?:\[.*?[^\\]\]|\\(?=.))/g,
    REPLACEMENTS: {
      __proto__: null,
      "***": "*",
      "**/**": "**",
      "**/**/**": "**"
    },
    CHAR_0: 48,
    CHAR_9: 57,
    CHAR_UPPERCASE_A: 65,
    CHAR_LOWERCASE_A: 97,
    CHAR_UPPERCASE_Z: 90,
    CHAR_LOWERCASE_Z: 122,
    CHAR_LEFT_PARENTHESES: 40,
    CHAR_RIGHT_PARENTHESES: 41,
    CHAR_ASTERISK: 42,
    CHAR_AMPERSAND: 38,
    CHAR_AT: 64,
    CHAR_BACKWARD_SLASH: 92,
    CHAR_CARRIAGE_RETURN: 13,
    CHAR_CIRCUMFLEX_ACCENT: 94,
    CHAR_COLON: 58,
    CHAR_COMMA: 44,
    CHAR_DOT: 46,
    CHAR_DOUBLE_QUOTE: 34,
    CHAR_EQUAL: 61,
    CHAR_EXCLAMATION_MARK: 33,
    CHAR_FORM_FEED: 12,
    CHAR_FORWARD_SLASH: 47,
    CHAR_GRAVE_ACCENT: 96,
    CHAR_HASH: 35,
    CHAR_HYPHEN_MINUS: 45,
    CHAR_LEFT_ANGLE_BRACKET: 60,
    CHAR_LEFT_CURLY_BRACE: 123,
    CHAR_LEFT_SQUARE_BRACKET: 91,
    CHAR_LINE_FEED: 10,
    CHAR_NO_BREAK_SPACE: 160,
    CHAR_PERCENT: 37,
    CHAR_PLUS: 43,
    CHAR_QUESTION_MARK: 63,
    CHAR_RIGHT_ANGLE_BRACKET: 62,
    CHAR_RIGHT_CURLY_BRACE: 125,
    CHAR_RIGHT_SQUARE_BRACKET: 93,
    CHAR_SEMICOLON: 59,
    CHAR_SINGLE_QUOTE: 39,
    CHAR_SPACE: 32,
    CHAR_TAB: 9,
    CHAR_UNDERSCORE: 95,
    CHAR_VERTICAL_LINE: 124,
    CHAR_ZERO_WIDTH_NOBREAK_SPACE: 65279,
    extglobChars(chars) {
      return {
        "!": { type: "negate", open: "(?:(?!(?:", close: `))${chars.STAR})` },
        "?": { type: "qmark", open: "(?:", close: ")?" },
        "+": { type: "plus", open: "(?:", close: ")+" },
        "*": { type: "star", open: "(?:", close: ")*" },
        "@": { type: "at", open: "(?:", close: ")" }
      };
    },
    globChars(win32) {
      return win32 === true ? WINDOWS_CHARS : POSIX_CHARS;
    }
  };
});

// ../../../node_modules/.bun/picomatch@4.0.7/node_modules/picomatch/lib/utils.js
var require_utils = __commonJS((exports) => {
  var {
    REGEX_BACKSLASH,
    REGEX_REMOVE_BACKSLASH,
    REGEX_SPECIAL_CHARS,
    REGEX_SPECIAL_CHARS_GLOBAL
  } = require_constants();
  exports.isObject = (val) => val !== null && typeof val === "object" && !Array.isArray(val);
  exports.hasRegexChars = (str) => REGEX_SPECIAL_CHARS.test(str);
  exports.isRegexChar = (str) => str.length === 1 && exports.hasRegexChars(str);
  exports.escapeRegex = (str) => str.replace(REGEX_SPECIAL_CHARS_GLOBAL, "\\$1");
  exports.toPosixSlashes = (str) => str.replace(REGEX_BACKSLASH, "/");
  exports.isWindows = () => {
    if (typeof navigator !== "undefined" && navigator.platform) {
      const platform = navigator.platform.toLowerCase();
      return platform === "win32" || platform === "windows";
    }
    if (typeof process !== "undefined" && process.platform) {
      return process.platform === "win32";
    }
    return false;
  };
  exports.removeBackslashes = (str) => {
    return str.replace(REGEX_REMOVE_BACKSLASH, (match) => {
      return match === "\\" ? "" : match;
    });
  };
  exports.escapeLast = (input, char, lastIdx) => {
    const idx = input.lastIndexOf(char, lastIdx);
    if (idx === -1)
      return input;
    if (input[idx - 1] === "\\")
      return exports.escapeLast(input, char, idx - 1);
    return `${input.slice(0, idx)}\\${input.slice(idx)}`;
  };
  exports.removePrefix = (input, state = {}) => {
    let output = input;
    if (output.startsWith("./")) {
      output = output.slice(2);
      state.prefix = "./";
    }
    return output;
  };
  exports.wrapOutput = (input, state = {}, options = {}) => {
    const prepend = options.contains ? "" : "^";
    const append = options.contains ? "" : "$";
    let output = `${prepend}(?:${input})${append}`;
    if (state.negated === true) {
      output = `(?:^(?!${output}).*$)`;
    }
    return output;
  };
  exports.basename = (path, { windows } = {}) => {
    const segs = path.split(windows ? /[\\/]/ : "/");
    const last = segs[segs.length - 1];
    if (last === "") {
      return segs[segs.length - 2];
    }
    return last;
  };
});

// ../../../node_modules/.bun/picomatch@4.0.7/node_modules/picomatch/lib/scan.js
var require_scan = __commonJS((exports, module) => {
  var utils = require_utils();
  var {
    CHAR_ASTERISK,
    CHAR_AT,
    CHAR_BACKWARD_SLASH,
    CHAR_COMMA,
    CHAR_DOT,
    CHAR_EXCLAMATION_MARK,
    CHAR_FORWARD_SLASH,
    CHAR_LEFT_CURLY_BRACE,
    CHAR_LEFT_PARENTHESES,
    CHAR_LEFT_SQUARE_BRACKET,
    CHAR_PLUS,
    CHAR_QUESTION_MARK,
    CHAR_RIGHT_CURLY_BRACE,
    CHAR_RIGHT_PARENTHESES,
    CHAR_RIGHT_SQUARE_BRACKET
  } = require_constants();
  var isPathSeparator = (code) => {
    return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
  };
  var depth = (token) => {
    if (token.isPrefix !== true) {
      token.depth = token.isGlobstar ? Infinity : 1;
    }
  };
  var scan = (input, options) => {
    const opts = options || {};
    const length = input.length - 1;
    const scanToEnd = opts.parts === true || opts.tokens === true || opts.scanToEnd === true;
    const slashes = [];
    const tokens = [];
    const parts = [];
    let str = input;
    let index = -1;
    let start = 0;
    let lastIndex = 0;
    let isBrace = false;
    let isBracket = false;
    let isGlob = false;
    let isExtglob = false;
    let isGlobstar = false;
    let braceEscaped = false;
    let backslashes = false;
    let negated = false;
    let negatedExtglob = false;
    let finished = false;
    let braces = 0;
    let prev;
    let code;
    let token = { value: "", depth: 0, isGlob: false };
    const eos = () => index >= length;
    const peek = () => str.charCodeAt(index + 1);
    const advance = () => {
      prev = code;
      return str.charCodeAt(++index);
    };
    while (index < length) {
      code = advance();
      let next;
      if (code === CHAR_BACKWARD_SLASH) {
        backslashes = token.backslashes = true;
        code = advance();
        if (code === CHAR_LEFT_CURLY_BRACE) {
          braceEscaped = true;
        }
        continue;
      }
      if (braceEscaped === true || code === CHAR_LEFT_CURLY_BRACE) {
        braces++;
        while (eos() !== true && (code = advance())) {
          if (code === CHAR_BACKWARD_SLASH) {
            backslashes = token.backslashes = true;
            advance();
            continue;
          }
          if (code === CHAR_LEFT_CURLY_BRACE) {
            braces++;
            continue;
          }
          if (braceEscaped !== true && code === CHAR_DOT && (code = advance()) === CHAR_DOT) {
            isBrace = token.isBrace = true;
            isGlob = token.isGlob = true;
            finished = true;
            if (scanToEnd === true) {
              continue;
            }
            break;
          }
          if (braceEscaped !== true && code === CHAR_COMMA) {
            isBrace = token.isBrace = true;
            isGlob = token.isGlob = true;
            finished = true;
            if (scanToEnd === true) {
              continue;
            }
            break;
          }
          if (code === CHAR_RIGHT_CURLY_BRACE) {
            braces--;
            if (braces === 0) {
              braceEscaped = false;
              isBrace = token.isBrace = true;
              finished = true;
              break;
            }
          }
        }
        if (scanToEnd === true) {
          continue;
        }
        break;
      }
      if (code === CHAR_FORWARD_SLASH) {
        slashes.push(index);
        tokens.push(token);
        token = { value: "", depth: 0, isGlob: false };
        if (finished === true)
          continue;
        if (prev === CHAR_DOT && index === start + 1) {
          start += 2;
          continue;
        }
        lastIndex = index + 1;
        continue;
      }
      if (opts.noext !== true) {
        const isExtglobChar = code === CHAR_PLUS || code === CHAR_AT || code === CHAR_ASTERISK || code === CHAR_QUESTION_MARK || code === CHAR_EXCLAMATION_MARK;
        if (isExtglobChar === true && peek() === CHAR_LEFT_PARENTHESES) {
          isGlob = token.isGlob = true;
          isExtglob = token.isExtglob = true;
          finished = true;
          if (code === CHAR_EXCLAMATION_MARK && index === start) {
            negatedExtglob = true;
          }
          if (scanToEnd === true) {
            let parens = 0;
            while (eos() !== true && (code = advance())) {
              if (code === CHAR_BACKWARD_SLASH) {
                backslashes = token.backslashes = true;
                advance();
                continue;
              }
              if (code === CHAR_LEFT_PARENTHESES) {
                parens++;
                continue;
              }
              if (code === CHAR_RIGHT_PARENTHESES && --parens === 0) {
                finished = true;
                break;
              }
            }
            continue;
          }
          break;
        }
      }
      if (code === CHAR_ASTERISK) {
        if (prev === CHAR_ASTERISK)
          isGlobstar = token.isGlobstar = true;
        isGlob = token.isGlob = true;
        finished = true;
        if (scanToEnd === true) {
          continue;
        }
        break;
      }
      if (code === CHAR_QUESTION_MARK) {
        isGlob = token.isGlob = true;
        finished = true;
        if (scanToEnd === true) {
          continue;
        }
        break;
      }
      if (code === CHAR_LEFT_SQUARE_BRACKET) {
        while (eos() !== true && (next = advance())) {
          if (next === CHAR_BACKWARD_SLASH) {
            backslashes = token.backslashes = true;
            advance();
            continue;
          }
          if (next === CHAR_RIGHT_SQUARE_BRACKET) {
            isBracket = token.isBracket = true;
            isGlob = token.isGlob = true;
            finished = true;
            break;
          }
        }
        if (scanToEnd === true) {
          continue;
        }
        break;
      }
      if (opts.nonegate !== true && code === CHAR_EXCLAMATION_MARK && index === start) {
        negated = token.negated = true;
        start++;
        continue;
      }
      if (opts.noparen !== true && code === CHAR_LEFT_PARENTHESES) {
        isGlob = token.isGlob = true;
        if (scanToEnd === true) {
          let parens = 1;
          while (eos() !== true && (code = advance())) {
            if (code === CHAR_BACKWARD_SLASH) {
              backslashes = token.backslashes = true;
              advance();
              continue;
            }
            if (code === CHAR_LEFT_PARENTHESES) {
              parens++;
              continue;
            }
            if (code === CHAR_RIGHT_PARENTHESES && --parens === 0) {
              finished = true;
              break;
            }
          }
          continue;
        }
        break;
      }
      if (isGlob === true) {
        finished = true;
        if (scanToEnd === true) {
          continue;
        }
        break;
      }
    }
    if (opts.noext === true) {
      isExtglob = false;
      isGlob = false;
    }
    let base = str;
    let prefix = "";
    let glob = "";
    if (start > 0) {
      prefix = str.slice(0, start);
      str = str.slice(start);
      lastIndex -= start;
    }
    if (base && isGlob === true && lastIndex > 0) {
      base = str.slice(0, lastIndex);
      glob = str.slice(lastIndex);
    } else if (isGlob === true) {
      base = "";
      glob = str;
    } else {
      base = str;
    }
    if (base && base !== "" && base !== "/" && base !== str) {
      if (isPathSeparator(base.charCodeAt(base.length - 1))) {
        base = base.slice(0, -1);
      }
    }
    if (opts.unescape === true) {
      if (glob)
        glob = utils.removeBackslashes(glob);
      if (base && backslashes === true) {
        base = utils.removeBackslashes(base);
      }
    }
    const state = {
      prefix,
      input,
      start,
      base,
      glob,
      isBrace,
      isBracket,
      isGlob,
      isExtglob,
      isGlobstar,
      negated,
      negatedExtglob
    };
    if (opts.tokens === true) {
      state.maxDepth = 0;
      if (!isPathSeparator(code)) {
        tokens.push(token);
      }
      state.tokens = tokens;
    }
    if (opts.parts === true || opts.tokens === true) {
      let prevIndex;
      for (let idx = 0;idx < slashes.length; idx++) {
        const n2 = prevIndex !== undefined ? prevIndex + 1 : start;
        const i = slashes[idx];
        const value2 = input.slice(n2, i);
        if (opts.tokens) {
          if (idx === 0 && start !== 0) {
            tokens[idx].isPrefix = true;
            tokens[idx].value = prefix;
          } else {
            tokens[idx].value = value2;
          }
          depth(tokens[idx]);
          state.maxDepth += tokens[idx].depth;
        }
        if (i >= start) {
          parts.push(value2);
          prevIndex = i;
        }
      }
      const n = prevIndex !== undefined ? prevIndex + 1 : start;
      const value = input.slice(n);
      parts.push(value);
      if (opts.tokens && prevIndex && prevIndex + 1 < input.length) {
        tokens[tokens.length - 1].value = value;
        depth(tokens[tokens.length - 1]);
        state.maxDepth += tokens[tokens.length - 1].depth;
      }
      state.slashes = slashes;
      state.parts = parts;
    }
    return state;
  };
  module.exports = scan;
});

// ../../../node_modules/.bun/picomatch@4.0.7/node_modules/picomatch/lib/parse.js
var require_parse = __commonJS((exports, module) => {
  var constants = require_constants();
  var utils = require_utils();
  var {
    MAX_LENGTH,
    POSIX_REGEX_SOURCE,
    REGEX_NON_SPECIAL_CHARS,
    REGEX_SPECIAL_CHARS_BACKREF,
    REPLACEMENTS
  } = constants;
  var expandRange = (args, options) => {
    if (typeof options.expandRange === "function") {
      return options.expandRange(...args, options);
    }
    args.sort();
    const value = `[${args.join("-")}]`;
    try {
      new RegExp(value);
    } catch (ex) {
      return args.map((v) => utils.escapeRegex(v)).join("..");
    }
    return value;
  };
  var syntaxError = (type, char) => {
    return `Missing ${type}: "${char}" - use "\\\\${char}" to match literal characters`;
  };
  var splitTopLevel = (input) => {
    const parts = [];
    let bracket = 0;
    let paren = 0;
    let quote = 0;
    let value = "";
    let escaped = false;
    for (const ch of input) {
      if (escaped === true) {
        value += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        value += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        quote = quote === 1 ? 0 : 1;
        value += ch;
        continue;
      }
      if (quote === 0) {
        if (ch === "[") {
          bracket++;
        } else if (ch === "]" && bracket > 0) {
          bracket--;
        } else if (bracket === 0) {
          if (ch === "(") {
            paren++;
          } else if (ch === ")" && paren > 0) {
            paren--;
          } else if (ch === "|" && paren === 0) {
            parts.push(value);
            value = "";
            continue;
          }
        }
      }
      value += ch;
    }
    parts.push(value);
    return parts;
  };
  var isPlainBranch = (branch) => {
    let escaped = false;
    for (const ch of branch) {
      if (escaped === true) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (/[?*+@!()[\]{}]/.test(ch)) {
        return false;
      }
    }
    return true;
  };
  var normalizeSimpleBranch = (branch) => {
    let value = branch.trim();
    let changed = true;
    while (changed === true) {
      changed = false;
      if (/^@\([^\\()[\]{}|]+\)$/.test(value)) {
        value = value.slice(2, -1);
        changed = true;
      }
    }
    if (!isPlainBranch(value)) {
      return;
    }
    return value.replace(/\\(.)/g, "$1");
  };
  var hasRepeatedCharPrefixOverlap = (branches) => {
    const values = branches.map(normalizeSimpleBranch).filter(Boolean);
    for (let i = 0;i < values.length; i++) {
      for (let j = i + 1;j < values.length; j++) {
        const a = values[i];
        const b = values[j];
        const char = a[0];
        if (!char || a !== char.repeat(a.length) || b !== char.repeat(b.length)) {
          continue;
        }
        if (a === b || a.startsWith(b) || b.startsWith(a)) {
          return true;
        }
      }
    }
    return false;
  };
  var parseRepeatedExtglob = (pattern, requireEnd = true) => {
    if (pattern[0] !== "+" && pattern[0] !== "*" || pattern[1] !== "(") {
      return;
    }
    let bracket = 0;
    let paren = 0;
    let quote = 0;
    let escaped = false;
    for (let i = 1;i < pattern.length; i++) {
      const ch = pattern[i];
      if (escaped === true) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        quote = quote === 1 ? 0 : 1;
        continue;
      }
      if (quote === 1) {
        continue;
      }
      if (ch === "[") {
        bracket++;
        continue;
      }
      if (ch === "]" && bracket > 0) {
        bracket--;
        continue;
      }
      if (bracket > 0) {
        continue;
      }
      if (ch === "(") {
        paren++;
        continue;
      }
      if (ch === ")") {
        paren--;
        if (paren === 0) {
          if (requireEnd === true && i !== pattern.length - 1) {
            return;
          }
          return {
            type: pattern[0],
            body: pattern.slice(2, i),
            end: i
          };
        }
      }
    }
  };
  var buildCharClassStar = (chars) => {
    const source = chars.length === 1 ? utils.escapeRegex(chars[0]) : `[${chars.map((ch) => utils.escapeRegex(ch)).join("")}]`;
    return `${source}*`;
  };
  var getStarExtglobSequenceChars = (pattern) => {
    let index = 0;
    const chars = [];
    while (index < pattern.length) {
      const match = parseRepeatedExtglob(pattern.slice(index), false);
      if (!match || match.type !== "*") {
        return;
      }
      const branches = splitTopLevel(match.body).map((branch2) => branch2.trim());
      if (branches.length !== 1) {
        return;
      }
      const branch = normalizeSimpleBranch(branches[0]);
      if (!branch || branch.length !== 1) {
        return;
      }
      chars.push(branch);
      index += match.end + 1;
    }
    if (chars.length < 1) {
      return;
    }
    return chars;
  };
  var repeatedExtglobRecursion = (pattern) => {
    let depth = 0;
    let value = pattern.trim();
    let match = parseRepeatedExtglob(value);
    while (match) {
      depth++;
      value = match.body.trim();
      match = parseRepeatedExtglob(value);
    }
    return depth;
  };
  var analyzeRepeatedExtglob = (body, options) => {
    if (options.maxExtglobRecursion === false) {
      return { risky: false };
    }
    const max = typeof options.maxExtglobRecursion === "number" ? options.maxExtglobRecursion : constants.DEFAULT_MAX_EXTGLOB_RECURSION;
    const branches = splitTopLevel(body).map((branch) => branch.trim());
    if (branches.length > 1) {
      if (branches.some((branch) => branch === "") || branches.some((branch) => /^[*?]+$/.test(branch)) || hasRepeatedCharPrefixOverlap(branches)) {
        return { risky: true };
      }
    }
    const safeChars = [];
    let sawStarSequence = false;
    let combinable = true;
    for (const branch of branches) {
      const chars = getStarExtglobSequenceChars(branch);
      if (chars) {
        sawStarSequence = true;
        safeChars.push(...chars);
        continue;
      }
      const literal = normalizeSimpleBranch(branch);
      if (literal && literal.length === 1) {
        safeChars.push(literal);
        continue;
      }
      combinable = false;
      if (repeatedExtglobRecursion(branch) > max) {
        return { risky: true };
      }
    }
    if (sawStarSequence) {
      return combinable ? { risky: true, safeOutput: buildCharClassStar([...new Set(safeChars)]) } : { risky: true };
    }
    return { risky: false };
  };
  var parse = (input, options) => {
    if (typeof input !== "string") {
      throw new TypeError("Expected a string");
    }
    input = REPLACEMENTS[input] || input;
    const opts = { ...options };
    const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
    let len = input.length;
    if (len > max) {
      throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
    }
    const bos = { type: "bos", value: "", output: opts.prepend || "" };
    const tokens = [bos];
    const capture = opts.capture ? "" : "?:";
    const PLATFORM_CHARS = constants.globChars(opts.windows);
    const EXTGLOB_CHARS = constants.extglobChars(PLATFORM_CHARS);
    const {
      DOT_LITERAL,
      PLUS_LITERAL,
      SLASH_LITERAL,
      ONE_CHAR,
      DOTS_SLASH,
      NO_DOT,
      NO_DOT_SLASH,
      NO_DOTS_SLASH,
      QMARK,
      QMARK_NO_DOT,
      STAR,
      START_ANCHOR
    } = PLATFORM_CHARS;
    const globstar = (opts2) => {
      return `(${capture}(?:(?!${START_ANCHOR}${opts2.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
    };
    const nodot = opts.dot ? "" : NO_DOT;
    const qmarkNoDot = opts.dot ? QMARK : QMARK_NO_DOT;
    let star = opts.bash === true ? globstar(opts) : STAR;
    if (opts.capture) {
      star = `(${star})`;
    }
    if (typeof opts.noext === "boolean") {
      opts.noextglob = opts.noext;
    }
    const state = {
      input,
      index: -1,
      start: 0,
      dot: opts.dot === true,
      consumed: "",
      output: "",
      prefix: "",
      backtrack: false,
      negated: false,
      brackets: 0,
      braces: 0,
      parens: 0,
      quotes: 0,
      globstar: false,
      tokens
    };
    input = utils.removePrefix(input, state);
    len = input.length;
    const extglobs = [];
    const braces = [];
    const stack = [];
    let prev = bos;
    let value;
    const eos = () => state.index === len - 1;
    const peek = state.peek = (n = 1) => input[state.index + n];
    const advance = state.advance = () => input[++state.index] || "";
    const remaining = () => input.slice(state.index + 1);
    const consume = (value2 = "", num = 0) => {
      state.consumed += value2;
      state.index += num;
    };
    const append = (token) => {
      state.output += token.output != null ? token.output : token.value;
      consume(token.value);
    };
    const negate = () => {
      let count = 1;
      while (peek() === "!" && (peek(2) !== "(" || peek(3) === "?")) {
        advance();
        state.start++;
        count++;
      }
      if (count % 2 === 0) {
        return false;
      }
      state.negated = true;
      state.start++;
      return true;
    };
    const increment = (type) => {
      state[type]++;
      stack.push(type);
    };
    const decrement = (type) => {
      state[type]--;
      stack.pop();
    };
    const push = (tok) => {
      if (prev.type === "globstar") {
        const isBrace = state.braces > 0 && (tok.type === "comma" || tok.type === "brace");
        const isExtglob = tok.extglob === true || extglobs.length && (tok.type === "pipe" || tok.type === "paren");
        if (tok.type !== "slash" && tok.type !== "paren" && !isBrace && !isExtglob) {
          state.output = state.output.slice(0, -prev.output.length);
          prev.type = "star";
          prev.value = "*";
          prev.output = star;
          state.output += prev.output;
        }
      }
      if (extglobs.length && tok.type !== "paren") {
        extglobs[extglobs.length - 1].inner += tok.value;
      }
      if (tok.value || tok.output)
        append(tok);
      if (prev && prev.type === "text" && tok.type === "text") {
        prev.output = (prev.output || prev.value) + tok.value;
        prev.value += tok.value;
        return;
      }
      tok.prev = prev;
      tokens.push(tok);
      prev = tok;
    };
    const extglobOpen = (type, value2) => {
      const token = { ...EXTGLOB_CHARS[value2], conditions: 1, inner: "" };
      token.prev = prev;
      token.parens = state.parens;
      token.output = state.output;
      token.startIndex = state.index;
      token.tokensIndex = tokens.length;
      const output = (opts.capture ? "(" : "") + token.open;
      increment("parens");
      push({ type, value: value2, output: state.output ? "" : ONE_CHAR });
      push({ type: "paren", extglob: true, value: advance(), output });
      extglobs.push(token);
    };
    const extglobClose = (token) => {
      const literal = input.slice(token.startIndex, state.index + 1);
      const body = input.slice(token.startIndex + 2, state.index);
      const analysis = analyzeRepeatedExtglob(body, opts);
      if ((token.type === "plus" || token.type === "star") && analysis.risky) {
        const safeOutput = analysis.safeOutput ? (token.output ? "" : ONE_CHAR) + (opts.capture ? `(${analysis.safeOutput})` : analysis.safeOutput) : undefined;
        const open = tokens[token.tokensIndex];
        open.type = "text";
        open.value = literal;
        open.output = safeOutput || utils.escapeRegex(literal);
        for (let i = token.tokensIndex + 1;i < tokens.length; i++) {
          tokens[i].value = "";
          tokens[i].output = "";
          delete tokens[i].suffix;
        }
        state.output = token.output + open.output;
        state.backtrack = true;
        push({ type: "paren", extglob: true, value, output: "" });
        decrement("parens");
        return;
      }
      let output = token.close + (opts.capture ? ")" : "");
      let rest;
      if (token.type === "negate") {
        let extglobStar = star;
        if (token.inner && token.inner.length > 1 && token.inner.includes("/")) {
          extglobStar = globstar(opts);
        }
        if (extglobStar !== star || eos() || /^\)+$/.test(remaining())) {
          output = token.close = `)$))${extglobStar}`;
        }
        if (token.inner.includes("*") && (rest = remaining()) && /^\.[^\\/.]+$/.test(rest)) {
          const expression = parse(rest, { ...options, fastpaths: false }).output;
          output = token.close = `)${expression})${extglobStar})`;
        }
        if (token.prev.type === "bos") {
          state.negatedExtglob = true;
        }
      }
      push({ type: "paren", extglob: true, value, output });
      decrement("parens");
    };
    if (opts.fastpaths !== false && !/(^[*!]|[/()[\]{}"])/.test(input)) {
      let backslashes = false;
      let output = input.replace(REGEX_SPECIAL_CHARS_BACKREF, (m, esc, chars, first, rest, index) => {
        if (first === "\\") {
          backslashes = true;
          return m;
        }
        if (first === "?") {
          if (esc) {
            return esc + first + (rest ? QMARK.repeat(rest.length) : "");
          }
          if (index === 0) {
            return qmarkNoDot + (rest ? QMARK.repeat(rest.length) : "");
          }
          return QMARK.repeat(chars.length);
        }
        if (first === ".") {
          return DOT_LITERAL.repeat(chars.length);
        }
        if (first === "*") {
          if (esc) {
            return esc + first + (rest ? star : "");
          }
          return star;
        }
        return esc ? m : `\\${m}`;
      });
      if (backslashes === true) {
        if (opts.unescape === true) {
          output = output.replace(/\\/g, "");
        } else {
          output = output.replace(/\\+/g, (m) => {
            return m.length % 2 === 0 ? "\\\\" : m ? "\\" : "";
          });
        }
      }
      if (output === input && opts.contains === true) {
        state.output = input;
        return state;
      }
      state.output = utils.wrapOutput(output, state, options);
      return state;
    }
    while (!eos()) {
      value = advance();
      if (value === "\x00") {
        continue;
      }
      if (value === "\\") {
        const next = peek();
        if (next === "/" && opts.bash !== true) {
          continue;
        }
        if (next === "." || next === ";") {
          continue;
        }
        if (!next) {
          value += "\\";
          push({ type: "text", value });
          continue;
        }
        const match = /^\\+/.exec(remaining());
        let slashes = 0;
        if (match && match[0].length > 2) {
          slashes = match[0].length;
          state.index += slashes;
          if (slashes % 2 !== 0) {
            value += "\\";
          }
        }
        if (opts.unescape === true) {
          value = advance();
        } else {
          value += advance();
        }
        if (state.brackets === 0) {
          push({ type: "text", value });
          continue;
        }
      }
      if (state.brackets > 0 && (value !== "]" || prev.value === "[" || prev.value === "[^")) {
        if (opts.posix !== false && value === ":") {
          const inner = prev.value.slice(1);
          if (inner.includes("[")) {
            prev.posix = true;
            if (inner.includes(":")) {
              const idx = prev.value.lastIndexOf("[");
              const pre = prev.value.slice(0, idx);
              const rest2 = prev.value.slice(idx + 2);
              const posix = POSIX_REGEX_SOURCE[rest2];
              if (posix) {
                prev.value = pre + posix;
                state.backtrack = true;
                advance();
                if (!bos.output && tokens.indexOf(prev) === 1) {
                  bos.output = ONE_CHAR;
                }
                continue;
              }
            }
          }
        }
        if (value === "[" && peek() !== ":" || value === "-" && peek() === "]") {
          value = `\\${value}`;
        }
        if (value === "]" && (prev.value === "[" || prev.value === "[^")) {
          value = `\\${value}`;
        }
        if (opts.posix === true && value === "!" && prev.value === "[") {
          value = "^";
        }
        prev.value += value;
        append({ value });
        continue;
      }
      if (state.quotes === 1 && value !== '"') {
        value = utils.escapeRegex(value);
        prev.value += value;
        append({ value });
        continue;
      }
      if (value === '"') {
        state.quotes = state.quotes === 1 ? 0 : 1;
        if (opts.keepQuotes === true) {
          push({ type: "text", value });
        }
        continue;
      }
      if (value === "(") {
        increment("parens");
        push({ type: "paren", value });
        continue;
      }
      if (value === ")") {
        if (state.parens === 0 && opts.strictBrackets === true) {
          throw new SyntaxError(syntaxError("opening", "("));
        }
        const extglob = extglobs[extglobs.length - 1];
        if (extglob && state.parens === extglob.parens + 1) {
          extglobClose(extglobs.pop());
          continue;
        }
        push({ type: "paren", value, output: state.parens ? ")" : "\\)" });
        decrement("parens");
        continue;
      }
      if (value === "[") {
        if (opts.nobracket === true || !remaining().includes("]")) {
          if (opts.nobracket !== true && opts.strictBrackets === true) {
            throw new SyntaxError(syntaxError("closing", "]"));
          }
          value = `\\${value}`;
        } else {
          increment("brackets");
        }
        push({ type: "bracket", value });
        continue;
      }
      if (value === "]") {
        if (opts.nobracket === true || prev && prev.type === "bracket" && prev.value.length === 1) {
          push({ type: "text", value, output: `\\${value}` });
          continue;
        }
        if (state.brackets === 0) {
          if (opts.strictBrackets === true) {
            throw new SyntaxError(syntaxError("opening", "["));
          }
          push({ type: "text", value, output: `\\${value}` });
          continue;
        }
        decrement("brackets");
        const prevValue = prev.value.slice(1);
        if (prev.posix !== true && prevValue[0] === "^" && !prevValue.includes("/")) {
          value = `/${value}`;
        }
        prev.value += value;
        append({ value });
        if (opts.literalBrackets === false || utils.hasRegexChars(prevValue)) {
          continue;
        }
        const escaped = utils.escapeRegex(prev.value);
        state.output = state.output.slice(0, -prev.value.length);
        if (opts.literalBrackets === true) {
          state.output += escaped;
          prev.value = escaped;
          continue;
        }
        prev.value = `(${capture}${escaped}|${prev.value})`;
        state.output += prev.value;
        continue;
      }
      if (value === "{" && opts.nobrace !== true) {
        increment("braces");
        const open = {
          type: "brace",
          value,
          output: "(",
          outputIndex: state.output.length,
          tokensIndex: state.tokens.length
        };
        braces.push(open);
        push(open);
        continue;
      }
      if (value === "}") {
        const brace = braces[braces.length - 1];
        if (opts.nobrace === true || !brace) {
          push({ type: "text", value, output: value });
          continue;
        }
        let output = ")";
        if (brace.dots === true) {
          const arr = tokens.slice();
          const range = [];
          for (let i = arr.length - 1;i >= 0; i--) {
            tokens.pop();
            if (arr[i].type === "brace") {
              break;
            }
            if (arr[i].type !== "dots") {
              range.unshift(arr[i].value);
            }
          }
          output = expandRange(range, opts);
          state.backtrack = true;
        }
        if (brace.comma !== true && brace.dots !== true) {
          const out = state.output.slice(0, brace.outputIndex);
          const toks = state.tokens.slice(brace.tokensIndex);
          brace.value = brace.output = "\\{";
          value = output = "\\}";
          state.output = out;
          for (const t of toks) {
            state.output += t.output || t.value;
          }
        }
        push({ type: "brace", value, output });
        decrement("braces");
        braces.pop();
        continue;
      }
      if (value === "|") {
        if (extglobs.length > 0) {
          extglobs[extglobs.length - 1].conditions++;
        }
        push({ type: "text", value });
        continue;
      }
      if (value === ",") {
        let output = value;
        const brace = braces[braces.length - 1];
        if (brace && stack[stack.length - 1] === "braces") {
          brace.comma = true;
          output = "|";
        }
        push({ type: "comma", value, output });
        continue;
      }
      if (value === "/") {
        if (prev.type === "dot" && state.index === state.start + 1) {
          state.start = state.index + 1;
          state.consumed = "";
          state.output = "";
          tokens.pop();
          prev = bos;
          continue;
        }
        push({ type: "slash", value, output: SLASH_LITERAL });
        continue;
      }
      if (value === ".") {
        if (state.braces > 0 && prev.type === "dot") {
          if (prev.value === ".")
            prev.output = DOT_LITERAL;
          const brace = braces[braces.length - 1];
          prev.type = "dots";
          prev.output += value;
          prev.value += value;
          brace.dots = true;
          continue;
        }
        if (state.braces + state.parens === 0 && prev.type !== "bos" && prev.type !== "slash") {
          push({ type: "text", value, output: DOT_LITERAL });
          continue;
        }
        push({ type: "dot", value, output: DOT_LITERAL });
        continue;
      }
      if (value === "?") {
        const isGroup = prev && prev.value === "(";
        if (!isGroup && opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
          extglobOpen("qmark", value);
          continue;
        }
        if (prev && prev.type === "paren") {
          const next = peek();
          let output = value;
          if (prev.value === "(" && !/[!=<:]/.test(next) || next === "<" && !/<([!=]|\w+>)/.test(remaining())) {
            output = `\\${value}`;
          }
          push({ type: "text", value, output });
          continue;
        }
        if (opts.dot !== true && (prev.type === "slash" || prev.type === "bos")) {
          push({ type: "qmark", value, output: QMARK_NO_DOT });
          continue;
        }
        push({ type: "qmark", value, output: QMARK });
        continue;
      }
      if (value === "!") {
        if (opts.noextglob !== true && peek() === "(") {
          if (peek(2) !== "?" || !/[!=<:]/.test(peek(3))) {
            extglobOpen("negate", value);
            continue;
          }
        }
        if (opts.nonegate !== true && state.index === 0) {
          negate();
          continue;
        }
      }
      if (value === "+") {
        if (opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
          extglobOpen("plus", value);
          continue;
        }
        if (prev && prev.value === "(" || opts.regex === false) {
          push({ type: "plus", value, output: PLUS_LITERAL });
          continue;
        }
        if (prev && (prev.type === "bracket" || prev.type === "paren" || prev.type === "brace") || state.parens > 0) {
          push({ type: "plus", value });
          continue;
        }
        push({ type: "plus", value: PLUS_LITERAL });
        continue;
      }
      if (value === "@") {
        if (opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
          push({ type: "at", extglob: true, value, output: "" });
          continue;
        }
        push({ type: "text", value });
        continue;
      }
      if (value !== "*") {
        if (value === "$" || value === "^") {
          value = `\\${value}`;
        }
        const match = REGEX_NON_SPECIAL_CHARS.exec(remaining());
        if (match) {
          value += match[0];
          state.index += match[0].length;
        }
        push({ type: "text", value });
        continue;
      }
      if (prev && (prev.type === "globstar" || prev.star === true)) {
        prev.type = "star";
        prev.star = true;
        prev.value += value;
        prev.output = star;
        state.backtrack = true;
        state.globstar = true;
        consume(value);
        continue;
      }
      let rest = remaining();
      if (opts.noextglob !== true && /^\([^?]/.test(rest)) {
        extglobOpen("star", value);
        continue;
      }
      if (prev.type === "star") {
        if (opts.noglobstar === true) {
          consume(value);
          continue;
        }
        const prior = prev.prev;
        const before = prior.prev;
        const isStart = prior.type === "slash" || prior.type === "bos";
        const afterStar = before && (before.type === "star" || before.type === "globstar");
        if (opts.bash === true && (!isStart || rest[0] && rest[0] !== "/")) {
          push({ type: "star", value, output: "" });
          continue;
        }
        const isBrace = state.braces > 0 && (prior.type === "comma" || prior.type === "brace");
        const isExtglob = extglobs.length && (prior.type === "pipe" || prior.type === "paren");
        if (!isStart && prior.type !== "paren" && !isBrace && !isExtglob) {
          push({ type: "star", value, output: "" });
          continue;
        }
        while (rest.slice(0, 3) === "/**") {
          const after = input[state.index + 4];
          if (after && after !== "/") {
            break;
          }
          rest = rest.slice(3);
          consume("/**", 3);
        }
        const isEnd = eos() || state.parens > 0 && rest === ")".repeat(state.parens) && !extglobs.some((extglob) => extglob.type === "negate");
        if (prior.type === "bos" && eos()) {
          prev.type = "globstar";
          prev.value += value;
          prev.output = globstar(opts);
          state.output = prev.output;
          state.globstar = true;
          consume(value);
          continue;
        }
        if (prior.type === "slash" && prior.prev.type !== "bos" && !afterStar && isEnd) {
          state.output = state.output.slice(0, -(prior.output + prev.output).length);
          prior.output = `(?:${prior.output}`;
          prev.type = "globstar";
          prev.output = globstar(opts) + (opts.strictSlashes ? ")" : "|$)");
          prev.value += value;
          state.globstar = true;
          state.output += prior.output + prev.output;
          consume(value);
          continue;
        }
        if (prior.type === "slash" && prior.prev.type !== "bos" && rest[0] === "/") {
          const end = rest[1] !== undefined ? "|$" : "";
          state.output = state.output.slice(0, -(prior.output + prev.output).length);
          prior.output = `(?:${prior.output}`;
          prev.type = "globstar";
          prev.output = `${globstar(opts)}${SLASH_LITERAL}|${SLASH_LITERAL}${end})`;
          prev.value += value;
          state.output += prior.output + prev.output;
          state.globstar = true;
          consume(value + advance());
          push({ type: "slash", value: "/", output: "" });
          continue;
        }
        if (prior.type === "bos" && rest[0] === "/") {
          prev.type = "globstar";
          prev.value += value;
          prev.output = `(?:^|${SLASH_LITERAL}|${globstar(opts)}${SLASH_LITERAL})`;
          state.output = prev.output;
          state.globstar = true;
          consume(value + advance());
          push({ type: "slash", value: "/", output: "" });
          continue;
        }
        state.output = state.output.slice(0, -prev.output.length);
        prev.type = "globstar";
        prev.output = globstar(opts);
        prev.value += value;
        state.output += prev.output;
        state.globstar = true;
        consume(value);
        continue;
      }
      const token = { type: "star", value, output: star };
      if (opts.bash === true) {
        token.output = ".*?";
        if (prev.type === "bos" || prev.type === "slash") {
          token.output = nodot + token.output;
        }
        push(token);
        continue;
      }
      if (prev && (prev.type === "bracket" || prev.type === "paren") && opts.regex === true) {
        token.output = value;
        push(token);
        continue;
      }
      if (state.index === state.start || prev.type === "slash" || prev.type === "dot") {
        if (prev.type === "dot") {
          state.output += NO_DOT_SLASH;
          prev.output += NO_DOT_SLASH;
        } else if (opts.dot === true) {
          state.output += NO_DOTS_SLASH;
          prev.output += NO_DOTS_SLASH;
        } else {
          state.output += nodot;
          prev.output += nodot;
        }
        if (peek() !== "*") {
          state.output += ONE_CHAR;
          prev.output += ONE_CHAR;
        }
      }
      push(token);
    }
    while (state.brackets > 0) {
      if (opts.strictBrackets === true)
        throw new SyntaxError(syntaxError("closing", "]"));
      state.output = utils.escapeLast(state.output, "[");
      decrement("brackets");
    }
    while (state.parens > 0) {
      if (opts.strictBrackets === true)
        throw new SyntaxError(syntaxError("closing", ")"));
      state.output = utils.escapeLast(state.output, "(");
      decrement("parens");
    }
    while (state.braces > 0) {
      if (opts.strictBrackets === true)
        throw new SyntaxError(syntaxError("closing", "}"));
      state.output = utils.escapeLast(state.output, "{");
      decrement("braces");
    }
    if (opts.strictSlashes !== true && (prev.type === "star" || prev.type === "bracket")) {
      push({ type: "maybe_slash", value: "", output: `${SLASH_LITERAL}?` });
    }
    if (state.backtrack === true) {
      state.output = "";
      for (const token of state.tokens) {
        state.output += token.output != null ? token.output : token.value;
        if (token.suffix) {
          state.output += token.suffix;
        }
      }
    }
    return state;
  };
  parse.fastpaths = (input, options) => {
    const opts = { ...options };
    const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
    const len = input.length;
    if (len > max) {
      throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
    }
    input = REPLACEMENTS[input] || input;
    const {
      DOT_LITERAL,
      SLASH_LITERAL,
      ONE_CHAR,
      DOTS_SLASH,
      NO_DOT,
      NO_DOTS,
      NO_DOTS_SLASH,
      STAR,
      START_ANCHOR
    } = constants.globChars(opts.windows);
    const nodot = opts.dot ? NO_DOTS : NO_DOT;
    const slashDot = opts.dot ? NO_DOTS_SLASH : NO_DOT;
    const capture = opts.capture ? "" : "?:";
    const state = { negated: false, prefix: "" };
    let star = opts.bash === true ? ".*?" : STAR;
    if (opts.capture) {
      star = `(${star})`;
    }
    const globstar = (opts2) => {
      if (opts2.noglobstar === true)
        return star;
      return `(${capture}(?:(?!${START_ANCHOR}${opts2.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
    };
    const create = (str) => {
      switch (str) {
        case "*":
          return `${nodot}${ONE_CHAR}${star}`;
        case ".*":
          return `${DOT_LITERAL}${ONE_CHAR}${star}`;
        case "*.*":
          return `${nodot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;
        case "*/*":
          return `${nodot}${star}${SLASH_LITERAL}${ONE_CHAR}${slashDot}${star}`;
        case "**":
          return nodot + globstar(opts);
        case "**/*":
          return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${ONE_CHAR}${star}`;
        case "**/*.*":
          return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;
        case "**/.*":
          return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${DOT_LITERAL}${ONE_CHAR}${star}`;
        default: {
          const match = /^(.*?)\.(\w+)$/.exec(str);
          if (!match)
            return;
          const source2 = create(match[1]);
          if (!source2)
            return;
          return source2 + DOT_LITERAL + match[2];
        }
      }
    };
    const output = utils.removePrefix(input, state);
    let source = create(output);
    if (source && opts.strictSlashes !== true) {
      source += `${SLASH_LITERAL}?`;
    }
    return source;
  };
  module.exports = parse;
});

// ../../../node_modules/.bun/picomatch@4.0.7/node_modules/picomatch/lib/picomatch.js
var require_picomatch = __commonJS((exports, module) => {
  var scan = require_scan();
  var parse = require_parse();
  var utils = require_utils();
  var constants = require_constants();
  var isObject = (val) => val && typeof val === "object" && !Array.isArray(val);
  var picomatch = (glob, options, returnState = false) => {
    if (Array.isArray(glob)) {
      const fns = glob.map((input) => picomatch(input, options, returnState));
      const arrayMatcher = (str) => {
        for (const isMatch of fns) {
          const state2 = isMatch(str);
          if (state2)
            return state2;
        }
        return false;
      };
      return arrayMatcher;
    }
    const isState = isObject(glob) && glob.tokens && glob.input;
    if (glob === "" || typeof glob !== "string" && !isState) {
      throw new TypeError("Expected pattern to be a non-empty string");
    }
    const opts = options || {};
    const posix = opts.windows;
    const regex = isState ? picomatch.compileRe(glob, options) : picomatch.makeRe(glob, options, false, true);
    const state = regex.state;
    delete regex.state;
    let isIgnored = () => false;
    if (opts.ignore) {
      const ignoreOpts = { ...options, ignore: null, onMatch: null, onResult: null };
      isIgnored = picomatch(opts.ignore, ignoreOpts, returnState);
    }
    const matcher = (input, returnObject = false) => {
      const { isMatch, match, output } = picomatch.test(input, regex, options, { glob, posix });
      const result = { glob, state, regex, posix, input, output, match, isMatch };
      if (typeof opts.onResult === "function") {
        opts.onResult(result);
      }
      if (isMatch === false) {
        result.isMatch = false;
        return returnObject ? result : false;
      }
      if (isIgnored(input)) {
        if (typeof opts.onIgnore === "function") {
          opts.onIgnore(result);
        }
        result.isMatch = false;
        return returnObject ? result : false;
      }
      if (typeof opts.onMatch === "function") {
        opts.onMatch(result);
      }
      return returnObject ? result : true;
    };
    if (returnState) {
      matcher.state = state;
    }
    return matcher;
  };
  picomatch.test = (input, regex, options, { glob, posix } = {}) => {
    if (typeof input !== "string") {
      throw new TypeError("Expected input to be a string");
    }
    if (input === "") {
      return { isMatch: false, output: "" };
    }
    const opts = options || {};
    const format = opts.format || (posix ? utils.toPosixSlashes : null);
    let match = input === glob;
    let output = match && format ? format(input) : input;
    if (match === false) {
      output = format ? format(input) : input;
      match = output === glob;
    }
    if (match === false || opts.capture === true) {
      if (opts.matchBase === true || opts.basename === true) {
        match = picomatch.matchBase(input, regex, options, posix);
      } else {
        match = regex.exec(output);
      }
    }
    return { isMatch: Boolean(match), match, output };
  };
  picomatch.matchBase = (input, glob, options, posix = options && options.windows) => {
    const regex = glob instanceof RegExp ? glob : picomatch.makeRe(glob, options);
    return regex.test(utils.basename(input, { windows: posix }));
  };
  picomatch.isMatch = (str, patterns, options) => picomatch(patterns, options)(str);
  picomatch.parse = (pattern, options) => {
    if (Array.isArray(pattern))
      return pattern.map((p) => picomatch.parse(p, options));
    return parse(pattern, { ...options, fastpaths: false });
  };
  picomatch.scan = (input, options) => scan(input, options);
  picomatch.compileRe = (state, options, returnOutput = false, returnState = false) => {
    if (returnOutput === true) {
      return state.output;
    }
    const opts = options || {};
    const prepend = opts.contains ? "" : "^";
    const append = opts.contains ? "" : "$";
    let source = `${prepend}(?:${state.output})${append}`;
    if (state && state.negated === true) {
      source = `^(?!${source}).*$`;
    }
    const regex = picomatch.toRegex(source, options);
    if (returnState === true) {
      regex.state = state;
    }
    return regex;
  };
  picomatch.makeRe = (input, options = {}, returnOutput = false, returnState = false) => {
    if (!input || typeof input !== "string") {
      throw new TypeError("Expected a non-empty string");
    }
    let parsed = { negated: false, fastpaths: true };
    if (options.fastpaths !== false && (input[0] === "." || input[0] === "*")) {
      parsed.output = parse.fastpaths(input, options);
    }
    if (!parsed.output) {
      parsed = parse(input, options);
    }
    return picomatch.compileRe(parsed, options, returnOutput, returnState);
  };
  picomatch.toRegex = (source, options) => {
    try {
      const opts = options || {};
      return new RegExp(source, opts.flags || (opts.nocase ? "i" : ""));
    } catch (err) {
      if (options && options.debug === true)
        throw err;
      return /$^/;
    }
  };
  picomatch.constants = constants;
  module.exports = picomatch;
});

// ../../../node_modules/.bun/picomatch@4.0.7/node_modules/picomatch/index.js
var require_picomatch2 = __commonJS((exports, module) => {
  var pico = require_picomatch();
  var utils = require_utils();
  function picomatch(glob, options, returnState = false) {
    if (options && (options.windows === null || options.windows === undefined)) {
      options = { ...options, windows: utils.isWindows() };
    }
    return pico(glob, options, returnState);
  }
  Object.assign(picomatch, pico);
  module.exports = picomatch;
});

// components/rules/src/cli.ts
import { stdin as processStdin, stdout as processStdout } from "node:process";

// ../../rules-engine/src/engine/cache.ts
var DYNAMIC_SESSION_KEY = "__pi-rules-session__";
function createSessionState(cwd) {
  return {
    cwd,
    staticDedup: new Set,
    dynamicDedup: new Map,
    dynamicTargetFingerprints: new Map,
    loadedRules: [],
    diagnostics: []
  };
}
function staticDedupKey(cwd, rulePath, contentHash) {
  return `${cwd}::${rulePath}::${contentHash}`;
}
function dynamicDedupKey(rulePath, contentHash) {
  return `${rulePath}::${contentHash}`;
}
function markStaticInjected(state, rule) {
  const key = staticDedupKey(state.cwd ?? "", rule.realPath, rule.contentHash);
  if (state.staticDedup.has(key)) {
    return false;
  }
  state.staticDedup.add(key);
  return true;
}
function markDynamicInjected(state, rule) {
  let keys = state.dynamicDedup.get(DYNAMIC_SESSION_KEY);
  if (keys === undefined) {
    keys = new Set;
    state.dynamicDedup.set(DYNAMIC_SESSION_KEY, keys);
  }
  const key = dynamicDedupKey(rule.realPath, rule.contentHash);
  if (keys.has(key)) {
    return false;
  }
  keys.add(key);
  return true;
}
function isStaticInjected(state, rule) {
  return state.staticDedup.has(staticDedupKey(state.cwd ?? "", rule.realPath, rule.contentHash));
}
function isDynamicInjected(state, rule) {
  return state.dynamicDedup.get(DYNAMIC_SESSION_KEY)?.has(dynamicDedupKey(rule.realPath, rule.contentHash)) === true;
}
function clearSession(state) {
  state.staticDedup.clear();
  state.dynamicDedup.clear();
  state.dynamicTargetFingerprints.clear();
  state.loadedRules.length = 0;
  state.diagnostics.length = 0;
}
// ../../rules-engine/src/engine/constants.ts
var PROJECT_MARKERS = [
  ".git",
  "pnpm-workspace.yaml",
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  ".venv"
];
var PROJECT_RULE_SUBDIRS = [
  [".omo", "rules"],
  [".claude", "rules"],
  [".cursor", "rules"],
  [".github", "instructions"]
];
var PROJECT_SINGLE_FILES = [".github/copilot-instructions.md", "CONTEXT.md"];
var USER_HOME_RULE_SUBDIRS = [".omo/rules", ".opencode/rules", ".claude/rules"];
var USER_HOME_SINGLE_FILES = [];
var BUNDLED_RULE_SUBDIR = "bundled-rules";
var RULE_FILE_EXTENSIONS = [".md", ".mdc"];
var SOURCE_PRIORITY = new Map([
  [".omo/rules", 0],
  [".claude/rules", 1],
  [".cursor/rules", 2],
  [".github/instructions", 3],
  [".github/copilot-instructions.md", 4],
  ["CONTEXT.md", 7],
  ["~/.omo/rules", 100],
  ["~/.opencode/rules", 101],
  ["~/.claude/rules", 102],
  ["plugin-bundled", 200]
]);
var GLOBAL_DISTANCE = 9999;
var DEFAULT_MAX_RULE_CHARS = 12000;
var DEFAULT_MAX_SCAN_FILES = 1000;
var DEFAULT_MAX_RESULT_CHARS = 40000;
var DEFAULT_POST_COMPACT_MAX_RULE_CHARS = 3500;
var DEFAULT_POST_COMPACT_MAX_RESULT_CHARS = 4000;
var DEFAULT_DYNAMIC_MAX_RULE_CHARS = 4000;
var DEFAULT_DYNAMIC_MAX_RESULT_CHARS = 1e4;
var DEFAULT_PROMPT_MAX_RULE_CHARS = 6000;
var DEFAULT_PROMPT_MAX_RESULT_CHARS = 16000;
var TRUNCATION_NOTICE = `

[Truncated. Full: {path}]`;
var SCANNER_EXCLUDED_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".turbo",
  ".next",
  "coverage"
];
// ../../rules-engine/src/engine/engine-dynamic-cache.ts
import { dirname as dirname2, resolve as resolve2 } from "node:path";

// ../../rules-engine/src/engine/engine-paths.ts
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
var ROOT_SINGLE_FILE_SOURCES = new Set(PROJECT_SINGLE_FILES.filter((source) => !source.includes("/")));
function isCandidateWithinProjectCached(candidate, projectRoot, projectMembership) {
  if (projectMembership === undefined) {
    return isCandidateWithinProject(candidate, projectRoot);
  }
  const cacheKey = `${projectRoot ?? ""}\x00${candidate.realPath}`;
  const cached = projectMembership.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const isWithinProject = isCandidateWithinProject(candidate, projectRoot);
  projectMembership.set(cacheKey, isWithinProject);
  return isWithinProject;
}
function isSameOrChildPath(childPath, parentPath) {
  const childRelativePath = relative(parentPath, resolve(childPath));
  return childRelativePath === "" || !childRelativePath.startsWith("..") && !isAbsolute(childRelativePath);
}
function isRootSingleFile(candidate) {
  return candidate.distance === 0 && candidate.isSingleFile && ROOT_SINGLE_FILE_SOURCES.has(candidate.source);
}
function pathBasesForTarget(projectRoot, targetFile, candidate) {
  const targetBasename = basename(targetFile);
  if (projectRoot === null) {
    return { projectRelative: targetBasename, basename: targetBasename };
  }
  const projectRelative = toPosixPath(relative(projectRoot, targetFile));
  const scopeDirectory = scopeDirectoryForCandidate(projectRoot, candidate);
  if (scopeDirectory === null) {
    return { projectRelative, basename: targetBasename };
  }
  return {
    projectRelative,
    scopeRelative: toPosixPath(relative(scopeDirectory, targetFile)),
    basename: targetBasename
  };
}
function toPosixPath(path) {
  return path.replaceAll("\\", "/");
}
function isCandidateWithinProject(candidate, projectRoot) {
  if (candidate.isGlobal) {
    return true;
  }
  if (projectRoot === null) {
    return false;
  }
  const relativeRealPath = relative(realPathOrResolved(projectRoot), realPathOrResolved(candidate.realPath));
  return relativeRealPath === "" || !relativeRealPath.startsWith("..") && !isAbsolute(relativeRealPath);
}
function realPathOrResolved(path) {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}
function scopeDirectoryForCandidate(projectRoot, candidate) {
  if (candidate.isGlobal) {
    return null;
  }
  if (candidate.isSingleFile) {
    return dirname(candidate.path);
  }
  const sourceIndex = candidate.relativePath.indexOf(candidate.source);
  if (sourceIndex === -1) {
    return projectRoot;
  }
  const scopeRelativeDirectory = candidate.relativePath.slice(0, sourceIndex).replace(/\/$/, "");
  return scopeRelativeDirectory.length === 0 ? projectRoot : join(projectRoot, scopeRelativeDirectory);
}

// ../../rules-engine/src/engine/ordering.ts
function sortCandidates(candidates) {
  return candidates.map((candidate, index) => ({ candidate, index })).sort((left, right) => compareCandidates(left.candidate, right.candidate) || left.index - right.index).map(({ candidate }) => candidate);
}
function compareCandidates(a, b) {
  return compareBoolean(a.isGlobal, b.isGlobal) || compareNumber(a.distance, b.distance) || compareNumber(SOURCE_PRIORITY.get(a.source) ?? Infinity, SOURCE_PRIORITY.get(b.source) ?? Infinity) || compareString(a.relativePath, b.relativePath) || compareString(a.realPath, b.realPath);
}
function compareBoolean(a, b) {
  return Number(a) - Number(b);
}
function compareNumber(a, b) {
  return a - b;
}
function compareString(a, b) {
  if (a < b)
    return -1;
  if (a > b)
    return 1;
  return 0;
}

// ../../rules-engine/src/engine/engine-dynamic-cache.ts
var MAX_DYNAMIC_MATCH_CACHE_ENTRIES = 4096;
function matchDynamicRuleCached(cache, projectRoot, targetFile, candidate, loadedRule, matchRuleImpl) {
  const cacheKey = dynamicMatchCacheKey(projectRoot, targetFile, candidate, loadedRule.contentHash);
  if (cache.has(cacheKey)) {
    const cachedReason = cache.get(cacheKey) ?? null;
    cache.delete(cacheKey);
    cache.set(cacheKey, cachedReason);
    return cachedReason;
  }
  const matchResult = matchRuleImpl({
    frontmatter: loadedRule.frontmatter,
    isSingleFile: candidate.isSingleFile,
    pathBases: pathBasesForTarget(projectRoot, targetFile, candidate)
  });
  const reason = matchResult.matched ? matchResult.reason : null;
  setDynamicMatchCacheEntry(cache, cacheKey, reason);
  return reason;
}
function findSortedCandidatesCached(cache, findCandidates, options) {
  const cacheKey = candidateDiscoveryCacheKey(options);
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const candidates = sortCandidates(findCandidates(options));
  cache.set(cacheKey, candidates);
  return candidates;
}
function setDynamicMatchCacheEntry(cache, cacheKey, reason) {
  if (cache.size >= MAX_DYNAMIC_MATCH_CACHE_ENTRIES) {
    const oldestCacheKey = cache.keys().next().value;
    if (oldestCacheKey !== undefined) {
      cache.delete(oldestCacheKey);
    }
  }
  cache.set(cacheKey, reason);
}
function dynamicMatchCacheKey(projectRoot, targetFile, candidate, contentHash) {
  return [
    projectRoot ?? "",
    toPosixPath(resolve2(targetFile)),
    candidate.realPath,
    candidate.relativePath,
    candidate.source,
    candidate.isGlobal ? "global" : "project",
    candidate.isSingleFile ? "single" : "multi",
    String(candidate.distance),
    contentHash
  ].join("\x00");
}
function candidateDiscoveryCacheKey(options) {
  return [
    options.projectRoot ?? "",
    options.targetFile === null ? "" : dirname2(resolve2(options.targetFile)),
    ...[...options.disabledSources ?? []].sort()
  ].join("\x00");
}

// ../../rules-engine/src/engine/matcher.ts
var import_picomatch = __toESM(require_picomatch2(), 1);
import { createHash } from "node:crypto";
var compiledPatternSets = new Map;
function matchRule(input) {
  if (input.isSingleFile) {
    return { matched: true, reason: "single-file" };
  }
  if (input.frontmatter.alwaysApply === true) {
    return { matched: true, reason: "alwaysApply" };
  }
  const patterns = normalizeGlobs(input.frontmatter);
  if (patterns.length === 0) {
    return noMatch();
  }
  const pathBases = normalizedPathBases(input.pathBases);
  const { positivePatterns, negativeMatchers } = compiledPatternSetFor(patterns);
  for (const { pattern, isMatch } of positivePatterns) {
    for (const pathBase of pathBases) {
      if (!isMatch(pathBase)) {
        continue;
      }
      if (isExcluded(pathBase, negativeMatchers)) {
        return noMatch();
      }
      return { matched: true, reason: { kind: "glob", pattern } };
    }
  }
  return noMatch();
}
function normalizeGlobs(frontmatter) {
  const patterns = [
    ...normalizePatternList(frontmatter.globs),
    ...normalizePatternList(frontmatter.paths),
    ...normalizePatternList(frontmatter.applyTo)
  ];
  return [...new Set(patterns.map(normalizePath))];
}
function hashContent(body) {
  return createHash("sha256").update(body).digest("hex");
}
function normalizePatternList(patterns) {
  if (patterns === undefined) {
    return [];
  }
  return Array.isArray(patterns) ? patterns : [patterns];
}
function normalizePath(path) {
  return path.replaceAll("\\", "/");
}
function normalizedPathBases(pathBases) {
  const normalizedBases = [normalizePath(pathBases.projectRelative)];
  if (pathBases.scopeRelative !== undefined) {
    normalizedBases.push(normalizePath(pathBases.scopeRelative));
  }
  normalizedBases.push(normalizePath(pathBases.basename));
  return normalizedBases;
}
function compiledPatternSetFor(patterns) {
  const cacheKey = JSON.stringify(patterns);
  const cached = compiledPatternSets.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const compiled = compilePatternSet(patterns);
  compiledPatternSets.set(cacheKey, compiled);
  return compiled;
}
function compilePatternSet(patterns) {
  const positivePatterns = [];
  const negativeMatchers = [];
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      negativeMatchers.push(createGlobMatcher(pattern.slice(1)));
      continue;
    }
    positivePatterns.push({ pattern, isMatch: createGlobMatcher(pattern) });
  }
  return { positivePatterns, negativeMatchers };
}
function createGlobMatcher(pattern) {
  return import_picomatch.default(normalizePath(pattern), { bash: true, dot: true });
}
function isExcluded(pathBase, negativeMatchers) {
  for (const isMatch of negativeMatchers) {
    if (isMatch(pathBase)) {
      return true;
    }
  }
  return false;
}
function noMatch() {
  return { matched: false, reason: { kind: "no-match" } };
}

// ../../rules-engine/src/engine/parser-frontmatter.ts
var FRONTMATTER_OPENING = `---
`;
var FRONTMATTER_OPENING_CRLF = `---\r
`;
function stripBom(content) {
  return content.startsWith("\uFEFF") ? content.slice(1) : content;
}
function getOpeningDelimiterLength(content) {
  if (content.startsWith(FRONTMATTER_OPENING_CRLF))
    return FRONTMATTER_OPENING_CRLF.length;
  if (content.startsWith(FRONTMATTER_OPENING))
    return FRONTMATTER_OPENING.length;
  return 0;
}
function findClosingDelimiter(content, openingLength) {
  let lineStart = openingLength;
  while (lineStart <= content.length) {
    const nextNewline = content.indexOf(`
`, lineStart);
    const lineEnd = nextNewline === -1 ? content.length : nextNewline;
    const line = content.slice(lineStart, lineEnd).replace(/\r$/, "");
    if (line === "---") {
      return {
        start: lineStart,
        bodyStart: nextNewline === -1 ? content.length : nextNewline + 1
      };
    }
    if (nextNewline === -1)
      break;
    lineStart = nextNewline + 1;
  }
  return null;
}

// ../../rules-engine/src/engine/errors.ts
class UnsupportedRuleSourceError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnsupportedRuleSourceError";
  }
}

class RuleFrontmatterParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "RuleFrontmatterParseError";
  }
}

// ../../rules-engine/src/engine/parser-yaml.ts
function parseYamlFrontmatter(yamlContent) {
  const lines = yamlContent.replace(/\r\n/g, `
`).split(`
`);
  const frontmatter = {};
  const globValues = [];
  const seenGlobs = new Set;
  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const rawLine = lines[lineIndex];
    if (rawLine === undefined)
      break;
    const line = stripComment(rawLine).trim();
    if (line.length === 0) {
      lineIndex += 1;
      continue;
    }
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      throw new RuleFrontmatterParseError(`Expected key-value pair on line ${lineIndex + 1}`);
    }
    const key = line.slice(0, colonIndex).trim();
    const rawValue = line.slice(colonIndex + 1).trim();
    if (key === "description") {
      frontmatter.description = parseStringValue(rawValue);
      lineIndex += 1;
      continue;
    }
    if (key === "alwaysApply") {
      frontmatter.alwaysApply = parseBooleanValue(rawValue, lineIndex + 1);
      lineIndex += 1;
      continue;
    }
    if (key === "globs" || key === "paths" || key === "applyTo") {
      const parsed = parseGlobValue(rawValue, lines, lineIndex);
      for (const glob of parsed.values) {
        if (!seenGlobs.has(glob)) {
          seenGlobs.add(glob);
          globValues.push(glob);
        }
      }
      lineIndex += parsed.consumed;
      continue;
    }
    lineIndex += 1;
  }
  const singleGlob = globValues[0];
  if (globValues.length === 1 && singleGlob !== undefined) {
    frontmatter.globs = singleGlob;
  } else if (globValues.length > 1) {
    frontmatter.globs = globValues;
  }
  return frontmatter;
}
function parseBooleanValue(value, lineNumber) {
  if (value === "true")
    return true;
  if (value === "false")
    return false;
  throw new RuleFrontmatterParseError(`Expected boolean on line ${lineNumber}`);
}
function parseGlobValue(rawValue, lines, lineIndex) {
  if (rawValue.startsWith("[")) {
    return { values: parseInlineArray(rawValue), consumed: 1 };
  }
  if (rawValue.length === 0) {
    return parseMultilineArray(lines, lineIndex);
  }
  const quotedScalar = isQuotedScalar(rawValue);
  const value = parseStringValue(rawValue);
  if (!quotedScalar && value.includes(",")) {
    return {
      values: value.split(",").map((item) => item.trim()).filter(Boolean),
      consumed: 1
    };
  }
  return { values: [value], consumed: 1 };
}
function isQuotedScalar(value) {
  return value.startsWith('"') || value.startsWith("'");
}
function parseMultilineArray(lines, lineIndex) {
  const values = [];
  let consumed = 1;
  for (let index = lineIndex + 1;index < lines.length; index += 1) {
    const rawLine = lines[index];
    if (rawLine === undefined)
      break;
    const lineWithoutComment = stripComment(rawLine);
    if (lineWithoutComment.trim().length === 0) {
      consumed += 1;
      continue;
    }
    const arrayItem = lineWithoutComment.match(/^\s+-\s*(.*)$/);
    if (arrayItem === null)
      break;
    values.push(parseStringValue(arrayItem[1] ?? ""));
    consumed += 1;
  }
  return { values: values.filter(Boolean), consumed };
}
function parseInlineArray(value) {
  const closingBracketIndex = findClosingBracket(value);
  if (closingBracketIndex === -1) {
    throw new RuleFrontmatterParseError("Unclosed inline array");
  }
  const trailing = value.slice(closingBracketIndex + 1).trim();
  if (trailing.length > 0) {
    throw new RuleFrontmatterParseError("Unexpected content after inline array");
  }
  const content = value.slice(1, closingBracketIndex).trim();
  if (content.length === 0)
    return [];
  return splitCommaSeparated(content).map(parseStringValue).filter(Boolean);
}
function findClosingBracket(value) {
  let quote = null;
  let escaped = false;
  for (let index = 0;index < value.length; index += 1) {
    const character = value[index];
    if (character === undefined)
      continue;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote !== null && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      if (quote === null)
        quote = character;
      else if (quote === character)
        quote = null;
      continue;
    }
    if (quote === null && character === "]")
      return index;
  }
  return -1;
}
function splitCommaSeparated(value) {
  const values = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (let index = 0;index < value.length; index += 1) {
    const character = value[index];
    if (character === undefined)
      continue;
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (quote !== null && character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      if (quote === null)
        quote = character;
      else if (quote === character)
        quote = null;
      current += character;
      continue;
    }
    if (quote === null && character === ",") {
      values.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (quote !== null) {
    throw new RuleFrontmatterParseError("Unclosed quoted value");
  }
  values.push(current.trim());
  return values.filter(Boolean);
}
function parseStringValue(value) {
  if (value.length === 0)
    return "";
  if (value.startsWith('"'))
    return parseJsonString(value);
  if (value.startsWith("'") && value.endsWith("'"))
    return value.slice(1, -1);
  if (value.startsWith("'"))
    throw new RuleFrontmatterParseError("Unclosed quoted value");
  return value;
}
function parseJsonString(value) {
  try {
    const parsedValue = JSON.parse(value);
    if (typeof parsedValue !== "string") {
      throw new RuleFrontmatterParseError("Expected JSON-quoted string");
    }
    return parsedValue;
  } catch (error) {
    if (error instanceof RuleFrontmatterParseError)
      throw error;
    throw new RuleFrontmatterParseError("Invalid JSON-quoted string");
  }
}
function stripComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0;index < line.length; index += 1) {
    const character = line[index];
    if (character === undefined)
      continue;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote !== null && character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"' || character === "'") {
      if (quote === null)
        quote = character;
      else if (quote === character)
        quote = null;
      continue;
    }
    if (quote === null && character === "#")
      return line.slice(0, index);
  }
  return line;
}

// ../../rules-engine/src/engine/parser.ts
function parseRule(content) {
  const normalizedContent = stripBom(content);
  const openingLength = getOpeningDelimiterLength(normalizedContent);
  if (openingLength === 0) {
    return { frontmatter: {}, body: normalizedContent };
  }
  const closingDelimiter = findClosingDelimiter(normalizedContent, openingLength);
  if (closingDelimiter === null) {
    return {
      frontmatter: {},
      body: normalizedContent,
      diagnostic: "Missing closing frontmatter delimiter"
    };
  }
  const yamlContent = normalizedContent.slice(openingLength, closingDelimiter.start);
  const body = normalizedContent.slice(closingDelimiter.bodyStart);
  try {
    return { frontmatter: parseYamlFrontmatter(yamlContent), body };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid YAML frontmatter";
    return {
      frontmatter: {},
      body: normalizedContent,
      diagnostic: `Malformed frontmatter: ${message}`
    };
  }
}

// ../../rules-engine/src/engine/engine-loader.ts
function loadCandidate(candidate, deps, diagnostics, projectRoot, loadedRuleContent, projectMembership) {
  if (!isCandidateWithinProjectCached(candidate, projectRoot, projectMembership)) {
    diagnostics.push({
      severity: "warning",
      source: candidate.path,
      message: "Rule file resolves outside project root"
    });
    return null;
  }
  const cachedContent = loadedRuleContent?.get(candidate.realPath);
  if (cachedContent !== undefined) {
    return loadedRuleFromContent(candidate, cachedContent, diagnostics);
  }
  const content = deps.readFile(candidate.path);
  if (content === null) {
    loadedRuleContent?.set(candidate.realPath, null);
    diagnostics.push({ severity: "warning", source: candidate.path, message: "Unable to read rule file" });
    return null;
  }
  const parsed = parseRule(content);
  const loadedContent = {
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    contentHash: hashContent(content),
    ...parsed.diagnostic === undefined ? {} : { diagnostic: parsed.diagnostic }
  };
  loadedRuleContent?.set(candidate.realPath, loadedContent);
  return loadedRuleFromContent(candidate, loadedContent, diagnostics);
}
function ruleDedupKey(rule) {
  return `${rule.realPath}::${rule.contentHash}`;
}
function staticMatchReason(rule) {
  if (rule.frontmatter.alwaysApply === true) {
    return "alwaysApply";
  }
  if (rule.isSingleFile) {
    return "single-file";
  }
  return null;
}
function loadedRuleFromContent(candidate, content, diagnostics) {
  if (content === null) {
    diagnostics.push({ severity: "warning", source: candidate.path, message: "Unable to read rule file" });
    return null;
  }
  if (content.diagnostic !== undefined) {
    diagnostics.push({ severity: "warning", source: candidate.path, message: content.diagnostic });
  }
  return {
    ...candidate,
    frontmatter: content.frontmatter,
    body: content.body,
    contentHash: content.contentHash,
    matchReason: { kind: "no-match" }
  };
}

// ../../rules-engine/src/engine/finder.ts
import { homedir } from "node:os";
import { join as join4, resolve as resolve6 } from "node:path";

// ../../rules-engine/src/engine/finder-cache.ts
import { existsSync as existsSync2, realpathSync as realpathSync3, statSync as statSync2 } from "node:fs";

// ../../rules-engine/src/engine/scanner.ts
import { existsSync, lstatSync, readdirSync, realpathSync as realpathSync2, statSync } from "node:fs";
import { isAbsolute as isAbsolute2, join as join2, resolve as resolve3 } from "node:path";
function scanRuleFiles(options) {
  const rootPath = toAbsolutePath(options.rootDir);
  if (!existsSync(rootPath)) {
    return [];
  }
  let rootStats;
  try {
    rootStats = statSync(rootPath);
  } catch {
    return [];
  }
  if (!rootStats.isDirectory()) {
    return [];
  }
  const results = [];
  const visitedDirectories = new Set;
  const excludedDirs = new Set(options.excludedDirs ?? SCANNER_EXCLUDED_DIRS);
  const maxDepth = options.maxDepth ?? 10;
  const maxFiles = normalizeMaxFiles(options.maxFiles);
  scanDirectory(rootPath, 0, maxDepth, maxFiles, excludedDirs, visitedDirectories, results);
  return results;
}
function normalizeMaxFiles(maxFiles) {
  const value = maxFiles ?? DEFAULT_MAX_SCAN_FILES;
  if (!Number.isFinite(value) || value < 0)
    return DEFAULT_MAX_SCAN_FILES;
  return Math.floor(value);
}
function toAbsolutePath(filePath) {
  return isAbsolute2(filePath) ? filePath : resolve3(filePath);
}
function scanDirectory(directoryPath, depth, maxDepth, maxFiles, excludedDirs, visitedDirectories, results) {
  if (results.length >= maxFiles) {
    return;
  }
  let realDirectoryPath;
  try {
    realDirectoryPath = realpathSync2.native(directoryPath);
  } catch {
    return;
  }
  if (visitedDirectories.has(realDirectoryPath)) {
    return;
  }
  visitedDirectories.add(realDirectoryPath);
  let entries;
  try {
    entries = readdirSync(directoryPath, { withFileTypes: true }).sort((leftEntry, rightEntry) => leftEntry.name.localeCompare(rightEntry.name));
  } catch {
    return;
  }
  for (const entry of entries) {
    if (results.length >= maxFiles) {
      return;
    }
    const entryPath = join2(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirs.has(entry.name) && depth < maxDepth) {
        scanDirectory(entryPath, depth + 1, maxDepth, maxFiles, excludedDirs, visitedDirectories, results);
      }
      continue;
    }
    if (entry.isSymbolicLink()) {
      scanSymbolicLink(entryPath, entry.name, depth, maxDepth, maxFiles, excludedDirs, visitedDirectories, results);
      continue;
    }
    if (entry.isFile() && isRuleFile(entry.name)) {
      results.push({ path: entryPath, realPath: resolveRealPath(entryPath) });
    }
  }
}
function scanSymbolicLink(linkPath, linkName, depth, maxDepth, maxFiles, excludedDirs, visitedDirectories, results) {
  if (results.length >= maxFiles) {
    return;
  }
  let targetStats;
  try {
    targetStats = statSync(linkPath);
  } catch {
    return;
  }
  if (targetStats.isDirectory()) {
    if (!excludedDirs.has(linkName) && depth < maxDepth) {
      scanDirectory(linkPath, depth + 1, maxDepth, maxFiles, excludedDirs, visitedDirectories, results);
    }
    return;
  }
  if (targetStats.isFile() && isRuleFile(linkName)) {
    results.push({ path: linkPath, realPath: resolveRealPath(linkPath) });
  }
}
function isRuleFile(fileName) {
  return RULE_FILE_EXTENSIONS.some((extension) => fileName.endsWith(extension));
}
function resolveRealPath(filePath) {
  try {
    const realPath = realpathSync2.native(filePath);
    const fileStats = lstatSync(filePath);
    return fileStats.isSymbolicLink() ? realPath : filePath;
  } catch {
    return filePath;
  }
}

// ../../rules-engine/src/engine/finder-cache.ts
function createRuleDiscoveryCache() {
  return { scannedRuleFiles: new Map, singleFileInfo: new Map };
}
function scanRuleFilesCached(rootDir, cache) {
  if (cache === undefined) {
    return scanRuleFiles({ rootDir });
  }
  const cached = cache.scannedRuleFiles.get(rootDir);
  if (cached !== undefined) {
    return cached;
  }
  const scannedFiles = scanRuleFiles({ rootDir });
  cache.scannedRuleFiles.set(rootDir, scannedFiles);
  return scannedFiles;
}
function singleFileInfoCached(filePath, cache) {
  if (cache === undefined) {
    return readSingleFileInfo(filePath);
  }
  const cached = cache.singleFileInfo.get(filePath);
  if (cached !== undefined) {
    return cached;
  }
  const fileInfo = readSingleFileInfo(filePath);
  cache.singleFileInfo.set(filePath, fileInfo);
  return fileInfo;
}
function readSingleFileInfo(filePath) {
  if (!existsSync2(filePath)) {
    return null;
  }
  try {
    if (!statSync2(filePath).isFile()) {
      return null;
    }
    return { path: filePath, realPath: resolveRealPath2(filePath) };
  } catch {
    return null;
  }
}
function resolveRealPath2(filePath) {
  try {
    return realpathSync3.native(filePath);
  } catch {
    return filePath;
  }
}

// ../../rules-engine/src/engine/finder-paths.ts
import { dirname as dirname3, posix, relative as relative2, resolve as resolve4 } from "node:path";
function getWalkDirectories(projectRoot, targetFile) {
  if (targetFile === null) {
    return [{ directory: projectRoot, distance: 0 }];
  }
  const startDirectory = dirname3(resolve4(targetFile));
  if (!isSameOrChildPath2(startDirectory, projectRoot)) {
    return [{ directory: projectRoot, distance: 0 }];
  }
  const walkDirectories = [];
  let currentDirectory = startDirectory;
  let distance = 0;
  while (true) {
    walkDirectories.push({ directory: currentDirectory, distance });
    if (currentDirectory === projectRoot) {
      break;
    }
    const parentDirectory = dirname3(currentDirectory);
    if (parentDirectory === currentDirectory) {
      break;
    }
    currentDirectory = parentDirectory;
    distance += 1;
  }
  return walkDirectories;
}
function toRelativePath(rootDirectory, filePath) {
  return posix.normalize(relative2(rootDirectory, filePath).replace(/\\/g, "/"));
}
function isSameOrChildPath2(childPath, parentPath) {
  const childRelativePath = relative2(parentPath, childPath);
  return childRelativePath === "" || !childRelativePath.startsWith("..") && !childRelativePath.startsWith("/");
}

// ../../rules-engine/src/engine/finder-sources.ts
function toProjectRuleSource(parentDirectory, subDirectory) {
  const source = `${parentDirectory}/${subDirectory}`;
  switch (source) {
    case ".omo/rules":
    case ".claude/rules":
    case ".cursor/rules":
    case ".github/instructions":
      return source;
    default:
      throw new UnsupportedRuleSourceError(`Unsupported project rule source: ${source}`);
  }
}
function toProjectSingleFileSource(ruleFile) {
  switch (ruleFile) {
    case ".github/copilot-instructions.md":
    case "CONTEXT.md":
      return ruleFile;
    default:
      throw new UnsupportedRuleSourceError(`Unsupported project single-file source: ${ruleFile}`);
  }
}
function toUserHomeRuleSource(ruleSubdir) {
  const source = `~/${ruleSubdir}`;
  switch (source) {
    case "~/.omo/rules":
    case "~/.opencode/rules":
    case "~/.claude/rules":
      return source;
    default:
      throw new UnsupportedRuleSourceError(`Unsupported user-home rule source: ${source}`);
  }
}
function toUserHomeSingleFileSource(ruleFile) {
  const source = `~/${ruleFile}`;
  switch (source) {
    default:
      throw new UnsupportedRuleSourceError(`Unsupported user-home single-file source: ${source}`);
  }
}

// ../../rules-engine/src/engine/plugin-root.ts
import { statSync as statSync3 } from "node:fs";
import { join as join3, resolve as resolve5 } from "node:path";
import { fileURLToPath } from "node:url";
function resolvePluginRulesRoot(pluginRoot, moduleUrl = import.meta.url) {
  const configuredRoot = pluginRoot ?? process.env["PLUGIN_ROOT"];
  if (configuredRoot !== undefined && configuredRoot.trim().length > 0) {
    return resolveRulesComponentRoot(resolve5(configuredRoot));
  }
  return fileURLToPath(new URL("../../..", moduleUrl));
}
function resolveRulesComponentRoot(pluginRoot) {
  const componentRoot = join3(pluginRoot, "components", "rules");
  return isDirectory(componentRoot) ? componentRoot : pluginRoot;
}
function isDirectory(path) {
  try {
    return statSync3(path).isDirectory();
  } catch {
    return false;
  }
}

// ../../rules-engine/src/engine/finder.ts
var WINDOWS_GIT_BASH_BUNDLED_RULE_PATH = "bundled-rules/windows-git-bash.md";
var HEPHAESTUS_BUNDLED_RULE_PREFIX = "bundled-rules/hephaestus/";
var HEPHAESTUS_DEFAULT_VARIANT_FILE = "gpt-5.5.md";
var HEPHAESTUS_MODEL_VARIANT_FILES = [
  ["gpt-5.6", "gpt-5.6.md"]
];
function findRuleCandidates(options) {
  const skipUserHome = options.skipUserHome ?? false;
  const disabledSources = options.disabledSources ?? new Set;
  const candidates = [];
  const homeDirectory = resolve6(options.homeDir ?? homedir());
  if (options.projectRoot !== null) {
    candidates.push(...findProjectCandidates(options.projectRoot, options.targetFile, disabledSources, options.cache));
  }
  const pluginBundledOptions = {
    disabledSources,
    ...options.cache === undefined ? {} : { cache: options.cache },
    ...options.pluginRoot === undefined ? {} : { pluginRoot: options.pluginRoot },
    ...options.platform === undefined ? {} : { platform: options.platform },
    ...options.model === undefined ? {} : { model: options.model }
  };
  candidates.push(...findPluginBundledCandidates(pluginBundledOptions));
  if (!skipUserHome) {
    candidates.push(...findUserHomeCandidates(homeDirectory, disabledSources, options.cache));
  }
  return candidates;
}
function findPluginBundledCandidates(options = {}) {
  if (options.disabledSources?.has("plugin-bundled") === true) {
    return [];
  }
  const pluginRoot = resolvePluginRulesRoot(options.pluginRoot);
  const ruleDirectory = join4(pluginRoot, BUNDLED_RULE_SUBDIR);
  const platform = options.platform ?? process.platform;
  const candidates = [];
  for (const scannedFile of scanRuleFilesCached(ruleDirectory, options.cache)) {
    const candidate = {
      path: scannedFile.path,
      realPath: scannedFile.realPath,
      source: "plugin-bundled",
      distance: GLOBAL_DISTANCE,
      isGlobal: true,
      isSingleFile: false,
      relativePath: toRelativePath(pluginRoot, scannedFile.path)
    };
    if (isPluginBundledCandidateEnabled(candidate, platform, options.model)) {
      candidates.push(candidate);
    }
  }
  return candidates;
}
function isPluginBundledCandidateEnabled(candidate, platform, model) {
  if (candidate.relativePath === WINDOWS_GIT_BASH_BUNDLED_RULE_PATH) {
    return platform === "win32";
  }
  if (candidate.relativePath.startsWith(HEPHAESTUS_BUNDLED_RULE_PREFIX)) {
    return candidate.relativePath === `${HEPHAESTUS_BUNDLED_RULE_PREFIX}${hephaestusVariantFileForModel(model)}`;
  }
  return true;
}
function hephaestusVariantFileForModel(model) {
  const normalizedModel = (model ?? "").toLowerCase();
  const matched = HEPHAESTUS_MODEL_VARIANT_FILES.find(([family]) => normalizedModel.includes(family));
  return matched === undefined ? HEPHAESTUS_DEFAULT_VARIANT_FILE : matched[1];
}
function findProjectCandidates(projectRoot, targetFile, disabledSources, cache) {
  const rootDirectory = resolve6(projectRoot);
  const walkDirectories = getWalkDirectories(rootDirectory, targetFile);
  const candidates = [];
  for (const walkDirectory of walkDirectories) {
    for (const [parentDirectory, subDirectory] of PROJECT_RULE_SUBDIRS) {
      const source = toProjectRuleSource(parentDirectory, subDirectory);
      if (disabledSources.has(source)) {
        continue;
      }
      const ruleDirectory = join4(walkDirectory.directory, parentDirectory, subDirectory);
      for (const scannedFile of scanRuleFilesCached(ruleDirectory, cache)) {
        candidates.push({
          path: scannedFile.path,
          realPath: scannedFile.realPath,
          source,
          distance: targetFile === null ? 0 : walkDirectory.distance,
          isGlobal: false,
          isSingleFile: false,
          relativePath: toRelativePath(rootDirectory, scannedFile.path)
        });
      }
    }
  }
  for (const walkDirectory of walkDirectories) {
    for (const ruleFile of PROJECT_SINGLE_FILES) {
      const source = toProjectSingleFileSource(ruleFile);
      if (disabledSources.has(source)) {
        continue;
      }
      const filePath = join4(walkDirectory.directory, ruleFile);
      const fileInfo = singleFileInfoCached(filePath, cache);
      if (fileInfo === null) {
        continue;
      }
      candidates.push({
        path: fileInfo.path,
        realPath: fileInfo.realPath,
        source,
        distance: targetFile === null ? 0 : walkDirectory.distance,
        isGlobal: false,
        isSingleFile: true,
        relativePath: toRelativePath(rootDirectory, filePath)
      });
    }
  }
  return candidates;
}
function findUserHomeCandidates(homeDirectory, disabledSources, cache) {
  const candidates = [];
  for (const ruleSubdir of USER_HOME_RULE_SUBDIRS) {
    const source = toUserHomeRuleSource(ruleSubdir);
    if (disabledSources.has(source)) {
      continue;
    }
    const ruleDirectory = join4(homeDirectory, ruleSubdir);
    for (const scannedFile of scanRuleFilesCached(ruleDirectory, cache)) {
      candidates.push({
        path: scannedFile.path,
        realPath: scannedFile.realPath,
        source,
        distance: GLOBAL_DISTANCE,
        isGlobal: true,
        isSingleFile: false,
        relativePath: toRelativePath(homeDirectory, scannedFile.path)
      });
    }
  }
  for (const ruleFile of USER_HOME_SINGLE_FILES) {
    const source = toUserHomeSingleFileSource(ruleFile);
    if (disabledSources.has(source)) {
      continue;
    }
    const filePath = join4(homeDirectory, ruleFile);
    const fileInfo = singleFileInfoCached(filePath, cache);
    if (fileInfo === null) {
      continue;
    }
    candidates.push({
      path: fileInfo.path,
      realPath: fileInfo.realPath,
      source,
      distance: GLOBAL_DISTANCE,
      isGlobal: true,
      isSingleFile: true,
      relativePath: toRelativePath(homeDirectory, filePath)
    });
  }
  return candidates;
}

// ../../rules-engine/src/engine/sources.ts
var DEFAULT_AUTO_DISABLED_SOURCES = ["AGENTS.md", "~/.claude/rules", "~/.claude/CLAUDE.md"];
function disabledSourcesFromConfig(config) {
  if (config.enabledSources === "auto") {
    return new Set(DEFAULT_AUTO_DISABLED_SOURCES);
  }
  const enabledSources = new Set(config.enabledSources);
  return new Set([...SOURCE_PRIORITY.keys()].filter((source) => !enabledSources.has(source)));
}

// ../../rules-engine/src/engine/engine-dynamic-loader.ts
function loadDynamicCandidates(config, deps, cwd, targetPaths, dynamicMatchCache) {
  const rules = [];
  const diagnostics = [];
  const seenRules = new Set;
  const loadedRuleContent = new Map;
  const projectMembership = new Map;
  const disabledSources = disabledSourcesFromConfig(config);
  const discoveryCache = createRuleDiscoveryCache();
  const candidateDiscoveryCache = new Map;
  const cwdProjectRoot = deps.findProjectRoot(cwd);
  for (const targetFile of uniqueStrings(targetPaths)) {
    const projectRoot = cwdProjectRoot !== null && isSameOrChildPath(targetFile, cwdProjectRoot) ? cwdProjectRoot : deps.findProjectRoot(targetFile);
    const findOptions = {
      projectRoot,
      targetFile,
      cache: discoveryCache
    };
    if (disabledSources !== undefined) {
      findOptions.disabledSources = disabledSources;
    }
    const candidates = findSortedCandidatesCached(candidateDiscoveryCache, deps.findCandidates, findOptions);
    for (const candidate of candidates) {
      const loadedRule = loadCandidate(candidate, deps, diagnostics, projectRoot, loadedRuleContent, projectMembership);
      if (loadedRule === null) {
        continue;
      }
      const matchReason = matchDynamicRuleCached(dynamicMatchCache, projectRoot, targetFile, candidate, loadedRule, deps.matchRule ?? matchRule);
      if (matchReason === null) {
        continue;
      }
      const dedupKey = ruleDedupKey(loadedRule);
      if (seenRules.has(dedupKey)) {
        continue;
      }
      seenRules.add(dedupKey);
      rules.push({ ...loadedRule, matchReason });
    }
  }
  return { rules: sortCandidates(rules), diagnostics };
}
function uniqueStrings(values) {
  const uniqueValues = [];
  const seenValues = new Set;
  for (const value of values) {
    if (seenValues.has(value)) {
      continue;
    }
    seenValues.add(value);
    uniqueValues.push(value);
  }
  return uniqueValues;
}
// ../../rules-engine/src/engine/engine-static-loader.ts
function loadStaticCandidates(candidates, deps, projectRoot) {
  const rules = [];
  const diagnostics = [];
  let rootSingleFileSelected = false;
  for (const candidate of sortCandidates(candidates)) {
    if (isDedupedRootSingleFile(candidate, rootSingleFileSelected)) {
      continue;
    }
    const loadedRule = loadCandidate(candidate, deps, diagnostics, projectRoot);
    if (loadedRule === null) {
      continue;
    }
    const matchReason = staticMatchReason(loadedRule);
    if (matchReason === null) {
      continue;
    }
    if (isRootSingleFile(candidate)) {
      rootSingleFileSelected = true;
    }
    rules.push({ ...loadedRule, matchReason });
  }
  return { rules: sortCandidates(rules), diagnostics };
}
function isDedupedRootSingleFile(candidate, rootSingleFileSelected) {
  return rootSingleFileSelected && isRootSingleFile(candidate);
}
// ../../rules-engine/src/engine/truncator.ts
var NEVER_TRUNCATED_RULE_PATHS = new Set([
  "bundled-rules/hephaestus.md",
  "bundled-rules/hephaestus/gpt-5.5.md",
  "bundled-rules/hephaestus/gpt-5.6.md"
]);
function truncationNotice(relativePath) {
  return TRUNCATION_NOTICE.replace("{path}", relativePath);
}
function isNeverTruncatedRule(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  return NEVER_TRUNCATED_RULE_PATHS.has(normalized);
}
function safeSliceEnd(body, end) {
  if (end <= 0) {
    return 0;
  }
  const lastCodeUnit = body.charCodeAt(end - 1);
  if (lastCodeUnit >= 55296 && lastCodeUnit <= 56319) {
    return end - 1;
  }
  return end;
}
function truncateRule(body, options) {
  if (isNeverTruncatedRule(options.relativePath)) {
    return { body, truncated: false, originalLength: body.length };
  }
  if (body.length <= options.maxChars) {
    return { body, truncated: false, originalLength: body.length };
  }
  const notice = truncationNotice(options.relativePath);
  if (options.maxChars < notice.length) {
    return { body: notice, truncated: true, originalLength: body.length };
  }
  const sliceEnd = safeSliceEnd(body, options.maxChars - notice.length);
  return { body: `${body.slice(0, sliceEnd)}${notice}`, truncated: true, originalLength: body.length };
}
function truncateBudget(input) {
  const results = [];
  let remainingBudget = input.maxResultChars;
  for (const rule of input.rules) {
    if (isNeverTruncatedRule(rule.relativePath)) {
      results.push({ body: rule.body, truncated: false, relativePath: rule.relativePath });
      remainingBudget -= rule.body.length;
      continue;
    }
    if (remainingBudget >= rule.body.length) {
      results.push({ body: rule.body, truncated: false, relativePath: rule.relativePath });
      remainingBudget -= rule.body.length;
      continue;
    }
    const notice = truncationNotice(rule.relativePath);
    if (remainingBudget <= notice.length) {
      break;
    }
    const sliceEnd = safeSliceEnd(rule.body, remainingBudget - notice.length);
    const body = `${rule.body.slice(0, sliceEnd)}${notice}`;
    results.push({ body, truncated: true, relativePath: rule.relativePath });
    remainingBudget -= body.length;
  }
  return results;
}

// ../../rules-engine/src/engine/formatter.ts
function formatRule(rule) {
  const body = normalizeRuleBody(rule.body);
  if (body.length === 0) {
    return `Instructions from: ${rule.path}`;
  }
  return `Instructions from: ${rule.path}

${body}`;
}
function truncateRules(rules, options) {
  const perRuleNormalized = rules.map((rule) => ({
    path: rule.path,
    relativePath: rule.relativePath,
    body: normalizeRuleBody(rule.body),
    source: rule.source
  }));
  const perRuleResultChars = Math.floor(options.maxResultChars / Math.max(1, perRuleNormalized.length));
  const perRuleBudgeted = perRuleNormalized.map((rule) => ({
    path: rule.path,
    relativePath: rule.relativePath,
    body: isNeverTruncatedRule(rule.relativePath) ? rule.body : truncateRule(rule.body, {
      maxChars: Math.min(options.maxRuleChars, perRuleResultChars),
      relativePath: rule.relativePath
    }).body
  }));
  const budgetedRules = truncateBudget({
    rules: perRuleBudgeted.map((rule) => ({ body: rule.body, relativePath: rule.relativePath })),
    maxResultChars: options.maxResultChars
  });
  const truncatedRules = [];
  for (let index = 0;index < budgetedRules.length; index += 1) {
    const sourceRule = perRuleBudgeted[index];
    const budgetedRule = budgetedRules[index];
    if (sourceRule === undefined || budgetedRule === undefined) {
      continue;
    }
    truncatedRules.push({
      path: sourceRule.path,
      relativePath: budgetedRule.relativePath,
      body: budgetedRule.body
    });
  }
  return truncatedRules;
}
function formatStaticBlock(rules, options) {
  if (rules.length === 0) {
    return "";
  }
  if (options.maxResultChars <= 0) {
    return "";
  }
  const orderedRules = orderStaticRules(uniqueRulesByBody(rules));
  return ["## Project Instructions", "", truncateRules(orderedRules, options).map(formatRule).join(`

`)].join(`
`);
}
function orderStaticRules(rules) {
  const hephaestusRules = [];
  const otherRules = [];
  for (const rule of rules) {
    if (isHephaestusRule(rule)) {
      hephaestusRules.push(rule);
      continue;
    }
    otherRules.push(rule);
  }
  return [...hephaestusRules, ...otherRules];
}
function isHephaestusRule(rule) {
  return isNeverTruncatedRule(rule.relativePath.length > 0 ? rule.relativePath : rule.path);
}
function uniqueRulesByBody(rules) {
  const uniqueRules = [];
  const seenBodies = new Set;
  const userDescriptions = new Set;
  for (const rule of rules) {
    const descriptionKey = rule.frontmatter.description?.trim();
    if (rule.source === "plugin-bundled" && descriptionKey !== undefined && userDescriptions.has(descriptionKey)) {
      continue;
    }
    const bodyKey = normalizeRuleBody(rule.body);
    if (seenBodies.has(bodyKey)) {
      continue;
    }
    seenBodies.add(bodyKey);
    if (descriptionKey !== undefined && rule.source !== "plugin-bundled") {
      userDescriptions.add(descriptionKey);
    }
    uniqueRules.push(rule);
  }
  return uniqueRules;
}
function formatDynamicBlock(rules, targetRelativePath, options) {
  if (rules.length === 0) {
    return "";
  }
  return [
    `Additional project instructions matched for ${targetRelativePath}:`,
    "",
    truncateRules(rules, options).map(formatRule).join(`

`)
  ].join(`
`);
}
function normalizeRuleBody(body) {
  return body.replace(/\r\n/g, `
`).replace(/\r/g, `
`).trim();
}

// ../../rules-engine/src/engine/engine.ts
function defaultConfig() {
  return {
    disabled: false,
    mode: "both",
    maxRuleChars: DEFAULT_MAX_RULE_CHARS,
    maxResultChars: DEFAULT_MAX_RESULT_CHARS,
    postCompactMaxRuleChars: DEFAULT_POST_COMPACT_MAX_RULE_CHARS,
    postCompactMaxResultChars: DEFAULT_POST_COMPACT_MAX_RESULT_CHARS,
    dynamicMaxRuleChars: DEFAULT_DYNAMIC_MAX_RULE_CHARS,
    dynamicMaxResultChars: DEFAULT_DYNAMIC_MAX_RESULT_CHARS,
    promptMaxRuleChars: DEFAULT_PROMPT_MAX_RULE_CHARS,
    promptMaxResultChars: DEFAULT_PROMPT_MAX_RESULT_CHARS,
    enabledSources: "auto"
  };
}
function createEngine(config, deps) {
  const state = createSessionState();
  const dynamicMatchCache = new Map;
  function loadStaticRules(cwd) {
    state.cwd = cwd;
    if (config.disabled || config.mode === "off" || config.mode === "dynamic") {
      return emptyLoadResult(state);
    }
    const projectRoot = deps.findProjectRoot(cwd);
    const findOptions = {
      projectRoot,
      targetFile: null
    };
    const disabledSources = disabledSourcesFromConfig(config);
    if (disabledSources !== undefined) {
      findOptions.disabledSources = disabledSources;
    }
    const candidates = deps.findCandidates(findOptions);
    const result = loadStaticCandidates(candidates, deps, projectRoot);
    storeLastLoad(state, result.rules, result.diagnostics);
    return result;
  }
  function loadDynamicRules(cwd, targetPaths) {
    state.cwd = cwd;
    if (config.disabled || config.mode === "off" || config.mode === "static" || targetPaths.length === 0) {
      return emptyLoadResult(state);
    }
    const result = loadDynamicCandidates(config, deps, cwd, targetPaths, dynamicMatchCache);
    storeLastLoad(state, result.rules, result.diagnostics);
    return result;
  }
  return {
    state,
    config,
    loadStaticRules,
    loadDynamicRules,
    formatStatic: (rules) => formatStaticBlock(rules, { maxRuleChars: config.maxRuleChars, maxResultChars: config.maxResultChars }),
    formatDynamic: (rules, target) => formatDynamicBlock(rules, target, {
      maxRuleChars: config.maxRuleChars,
      maxResultChars: config.maxResultChars
    }),
    resetSession: (cwd) => {
      clearSession(state);
      dynamicMatchCache.clear();
      if (cwd !== undefined) {
        state.cwd = cwd;
      }
    },
    isStaticInjected: (rule) => isStaticInjected(state, rule),
    isDynamicInjected: (rule) => isDynamicInjected(state, rule),
    markStaticInjected: (rule) => markStaticInjected(state, rule),
    markDynamicInjected: (rule) => markDynamicInjected(state, rule)
  };
}
function storeLastLoad(state, rules, diagnostics) {
  state.loadedRules.length = 0;
  state.loadedRules.push(...rules);
  state.diagnostics.length = 0;
  state.diagnostics.push(...diagnostics);
}
function emptyLoadResult(state) {
  storeLastLoad(state, [], []);
  return { rules: [], diagnostics: [] };
}
// ../../rules-engine/src/engine/project-root.ts
import { existsSync as existsSync3, statSync as statSync4 } from "node:fs";
import { dirname as dirname4, join as join5, resolve as resolve7 } from "node:path";
function findProjectRoot(startPath, markers = PROJECT_MARKERS) {
  const resolvedStartPath = resolve7(startPath);
  if (!existsSync3(resolvedStartPath)) {
    return null;
  }
  const startStats = statSync4(resolvedStartPath);
  let currentDirectory = startStats.isDirectory() ? resolvedStartPath : dirname4(resolvedStartPath);
  const filesystemRoot = resolve7("/");
  while (true) {
    for (const marker of markers) {
      if (existsSync3(join5(currentDirectory, marker))) {
        return currentDirectory;
      }
    }
    const parentDirectory = dirname4(currentDirectory);
    if (currentDirectory === filesystemRoot || parentDirectory === currentDirectory) {
      return null;
    }
    currentDirectory = parentDirectory;
  }
}
// components/rules/src/config.ts
function configFromEnvironment(env = process.env) {
  const config = defaultConfig();
  const disableBundledRules = isTruthy(firstEnv(env, "CODEX_RULES_DISABLE_BUNDLED", "PI_RULES_DISABLE_BUNDLED"));
  config.disabled = isTruthy(firstEnv(env, "CODEX_RULES_DISABLED", "PI_RULES_DISABLED"));
  config.mode = parseMode(firstEnv(env, "CODEX_RULES_MODE", "PI_RULES_MODE")) ?? config.mode;
  config.maxRuleChars = parsePositiveInteger(firstEnv(env, "CODEX_RULES_MAX_RULE_CHARS", "PI_RULES_MAX_RULE_CHARS")) ?? config.maxRuleChars;
  config.maxResultChars = parsePositiveInteger(firstEnv(env, "CODEX_RULES_MAX_RESULT_CHARS", "PI_RULES_MAX_RESULT_CHARS")) ?? config.maxResultChars;
  config.postCompactMaxRuleChars = parsePositiveInteger(firstEnv(env, "CODEX_RULES_POST_COMPACT_MAX_RULE_CHARS", "PI_RULES_POST_COMPACT_MAX_RULE_CHARS")) ?? config.postCompactMaxRuleChars;
  config.postCompactMaxResultChars = parsePositiveInteger(firstEnv(env, "CODEX_RULES_POST_COMPACT_MAX_RESULT_CHARS", "PI_RULES_POST_COMPACT_MAX_RESULT_CHARS")) ?? config.postCompactMaxResultChars;
  config.dynamicMaxRuleChars = parsePositiveInteger(firstEnv(env, "CODEX_RULES_DYNAMIC_MAX_RULE_CHARS", "PI_RULES_DYNAMIC_MAX_RULE_CHARS")) ?? config.dynamicMaxRuleChars;
  config.dynamicMaxResultChars = parsePositiveInteger(firstEnv(env, "CODEX_RULES_DYNAMIC_MAX_RESULT_CHARS", "PI_RULES_DYNAMIC_MAX_RESULT_CHARS")) ?? config.dynamicMaxResultChars;
  config.promptMaxRuleChars = parsePositiveInteger(firstEnv(env, "CODEX_RULES_PROMPT_MAX_RULE_CHARS", "PI_RULES_PROMPT_MAX_RULE_CHARS")) ?? config.promptMaxRuleChars;
  config.promptMaxResultChars = parsePositiveInteger(firstEnv(env, "CODEX_RULES_PROMPT_MAX_RESULT_CHARS", "PI_RULES_PROMPT_MAX_RESULT_CHARS")) ?? config.promptMaxResultChars;
  config.enabledSources = parseEnabledSources(firstEnv(env, "CODEX_RULES_ENABLED_SOURCES", "PI_RULES_ENABLED_SOURCES"), disableBundledRules);
  return config;
}
function firstEnv(env, ...names) {
  for (const name of names) {
    const value = env[name];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return;
}
function isTruthy(value) {
  if (value === undefined)
    return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
function parseMode(value) {
  if (value === undefined)
    return;
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "static":
    case "dynamic":
    case "both":
    case "off":
      return normalized;
    default:
      return;
  }
}
function parsePositiveInteger(value) {
  if (value === undefined)
    return;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
function parseEnabledSources(value, disableBundledRules) {
  if (value === undefined || value.trim().toLowerCase() === "auto") {
    return disableBundledRules ? sourcesWithoutBundledRules() : "auto";
  }
  const sources = [];
  for (const rawSource of value.split(",")) {
    const source = toRuleSource(rawSource.trim());
    if (source === null) {
      continue;
    }
    sources.push(source);
  }
  const enabledSources = disableBundledRules ? sources.filter((source) => source !== "plugin-bundled") : sources;
  return enabledSources;
}
function sourcesWithoutBundledRules() {
  return [...SOURCE_PRIORITY.keys()].filter((source) => source !== "plugin-bundled");
}
function toRuleSource(value) {
  switch (value) {
    case ".omo/rules":
    case ".claude/rules":
    case ".cursor/rules":
    case ".github/instructions":
    case ".github/copilot-instructions.md":
    case "CONTEXT.md":
    case "plugin-bundled":
    case "~/.omo/rules":
    case "~/.opencode/rules":
    case "~/.claude/rules":
      return value;
    default:
      return null;
  }
}

// components/rules/src/context-pressure.ts
import { readFileSync } from "node:fs";
var CONTEXT_PRESSURE_MARKERS = [
  "context compacted",
  "context_length_exceeded",
  "skill descriptions were shortened",
  "context_too_large",
  "codex ran out of room in the model's context window",
  "your input exceeds the context window",
  "long threads and multiple compactions"
];
function hasContextPressureMarker(text) {
  const normalizedText = text.toLowerCase();
  return CONTEXT_PRESSURE_MARKERS.some((marker) => normalizedText.includes(marker));
}
function transcriptHasContextPressureMarker(transcriptPath) {
  if (transcriptPath === undefined || transcriptPath === null)
    return false;
  try {
    return hasContextPressureMarker(readFileSync(transcriptPath, "utf8"));
  } catch (error) {
    if (error instanceof Error)
      return false;
    throw error;
  }
}

// components/rules/src/debug-log.ts
import { performance } from "node:perf_hooks";
import { debuglog } from "node:util";
var debug = debuglog("codex-rules");
var noopTimer = {
  lap: () => {},
  done: () => {}
};
function createHookDebugTimer(hookName) {
  if (!debug.enabled) {
    return noopTimer;
  }
  const startMs = performance.now();
  let lastMs = startMs;
  return {
    lap: (phase, fields = {}) => {
      const nowMs = performance.now();
      writeDebugLine(hookName, phase, nowMs - lastMs, nowMs - startMs, fields);
      lastMs = nowMs;
    },
    done: (fields = {}) => {
      const nowMs = performance.now();
      writeDebugLine(hookName, "done", nowMs - lastMs, nowMs - startMs, fields);
      lastMs = nowMs;
    }
  };
}
function writeDebugLine(hookName, phase, durationMs, totalMs, fields) {
  debug("%s phase=%s ms=%s total_ms=%s%s", hookName, phase, durationMs.toFixed(3), totalMs.toFixed(3), formatFields(fields));
}
function formatFields(fields) {
  const entries = Object.entries(fields);
  if (entries.length === 0) {
    return "";
  }
  return ` ${entries.map(([key, value]) => `${key}=${String(value)}`).join(" ")}`;
}

// components/rules/src/dynamic-target-fingerprints.ts
import { statSync as statSync5 } from "node:fs";
import { resolve as resolve9 } from "node:path";

// components/rules/src/path-utils.ts
import { isAbsolute as isAbsolute3, relative as relative3, resolve as resolve8 } from "node:path";
function displayPath(cwd, filePath) {
  const rel = isAbsolute3(filePath) ? relative3(cwd, filePath) : filePath;
  return toPosixPath2(rel);
}
function isSameOrChildPath3(childPath, parentPath) {
  const childRelativePath = relative3(parentPath, resolve8(childPath));
  return childRelativePath === "" || !childRelativePath.startsWith("..") && !isAbsolute3(childRelativePath);
}
function toPosixPath2(path) {
  return path.replaceAll("\\", "/");
}
function uniqueStrings2(values) {
  const uniqueValues = [];
  const seenValues = new Set;
  for (const value of values) {
    if (seenValues.has(value)) {
      continue;
    }
    seenValues.add(value);
    uniqueValues.push(value);
  }
  return uniqueValues;
}

// components/rules/src/dynamic-target-fingerprints.ts
function fingerprintDynamicTargets(cwd, targetPaths, config, model) {
  const disabledSources = disabledSourcesFromConfig(config);
  const discoveryCache = createRuleDiscoveryCache();
  const cwdProjectRoot = findProjectRoot(cwd);
  const fingerprints = [];
  for (const targetPath of uniqueStrings2(targetPaths)) {
    const projectRoot = cwdProjectRoot !== null && isSameOrChildPath3(targetPath, cwdProjectRoot) ? cwdProjectRoot : findProjectRoot(targetPath);
    const findOptions = {
      projectRoot,
      targetFile: targetPath,
      cache: discoveryCache
    };
    if (disabledSources !== undefined) {
      findOptions.disabledSources = disabledSources;
    }
    if (model !== undefined) {
      findOptions.model = model;
    }
    const candidates = findRuleCandidates(findOptions);
    const candidateFingerprint = sortCandidates(candidates).map(fingerprintCandidate).join("\x01");
    const cacheKey = dynamicTargetCacheKey(targetPath);
    fingerprints.push({
      targetPath,
      cacheKey,
      fingerprint: hashContent([
        "v1",
        config.enabledSources === "auto" ? "auto" : config.enabledSources.join(","),
        model ?? "",
        projectRoot ?? "",
        cacheKey,
        candidateFingerprint
      ].join("\x00"))
    });
  }
  return fingerprints;
}
function fingerprintCandidate(candidate) {
  return [
    candidate.realPath,
    candidate.relativePath,
    candidate.source,
    candidate.isGlobal ? "global" : "project",
    candidate.isSingleFile ? "single" : "multi",
    String(candidate.distance),
    fileFingerprint(candidate.path)
  ].join("\x00");
}
function fileFingerprint(filePath) {
  try {
    const stats = statSync5(filePath, { bigint: true });
    return `${stats.mtimeNs}:${stats.ctimeNs}:${stats.size}`;
  } catch {
    return "missing";
  }
}
function dynamicTargetCacheKey(targetPath) {
  return toPosixPath2(resolve9(targetPath));
}

// components/rules/src/event-budget.ts
function withDynamicBudget(config) {
  return {
    ...config,
    maxRuleChars: Math.min(config.maxRuleChars, config.dynamicMaxRuleChars),
    maxResultChars: Math.min(config.maxResultChars, config.dynamicMaxResultChars)
  };
}
function withPromptBudget(config) {
  return {
    ...config,
    maxRuleChars: Math.min(config.maxRuleChars, config.promptMaxRuleChars),
    maxResultChars: Math.min(config.maxResultChars, config.promptMaxResultChars)
  };
}

// components/rules/src/hook-output.ts
var MAX_ADDITIONAL_CONTEXT_CHARS = 32000;
function formatAdditionalContextOutput(eventName, additionalContext) {
  const normalizedContext = limitAdditionalContext(normalizeAdditionalContext(additionalContext));
  if (normalizedContext.length === 0)
    return "";
  return `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: normalizedContext
    }
  })}
`;
}
function normalizeAdditionalContext(additionalContext) {
  return additionalContext.replace(/\r\n/g, `
`).replace(/\r/g, `
`).trim();
}
function limitAdditionalContext(additionalContext) {
  if (additionalContext.length <= MAX_ADDITIONAL_CONTEXT_CHARS)
    return additionalContext;
  const marker = `

[Truncated hook additional context to ${MAX_ADDITIONAL_CONTEXT_CHARS} chars to avoid Codex context overflow.]`;
  if (marker.length >= MAX_ADDITIONAL_CONTEXT_CHARS)
    return marker.slice(0, MAX_ADDITIONAL_CONTEXT_CHARS);
  const head = additionalContext.slice(0, MAX_ADDITIONAL_CONTEXT_CHARS - marker.length).replace(/[ \t\r\n]+$/, "");
  return `${head}${marker}`;
}

// components/rules/src/persistent-cache.ts
import { mkdirSync as mkdirSync2, readFileSync as readFileSync2, rmSync as rmSync2, writeFileSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname as dirname6, join as join6 } from "node:path";

// components/rules/src/post-compact-state.ts
function postCompactKindState(kinds) {
  if (kinds.size === 0) {
    return;
  }
  return {
    ...kinds.has("static") ? { static: true } : {},
    ...kinds.has("dynamic") ? { dynamic: true } : {}
  };
}
function postCompactPendingKinds(state) {
  const pendingKinds = new Set;
  if (state.compacted === true || state.postCompactPending?.static === true) {
    pendingKinds.add("static");
  }
  if (state.compacted === true || state.postCompactPending?.dynamic === true) {
    pendingKinds.add("dynamic");
  }
  return pendingKinds;
}
function postCompactRecoveringKinds(state) {
  const recoveringKinds = new Set;
  if (state.postCompactRecovering?.static === true) {
    recoveringKinds.add("static");
  }
  if (state.postCompactRecovering?.dynamic === true) {
    recoveringKinds.add("dynamic");
  }
  return recoveringKinds;
}

// components/rules/src/session-state-lock.ts
import { mkdirSync, rmSync } from "node:fs";
import { dirname as dirname5 } from "node:path";
var SESSION_STATE_LOCK_CONTENDED = Symbol("session-state-lock-contended");
var LOCK_RETRY_COUNT = 20;
var LOCK_RETRY_DELAY_MS = 5;
var LOCK_SLEEP_VIEW = new Int32Array(new SharedArrayBuffer(4));
function withSessionStateLock(cachePath, callback) {
  const lockPath = `${cachePath}.lock`;
  mkdirSync(dirname5(cachePath), { recursive: true });
  for (let attempt = 0;attempt < LOCK_RETRY_COUNT; attempt += 1) {
    try {
      mkdirSync(lockPath);
      try {
        return callback();
      } finally {
        rmSync(lockPath, { recursive: true, force: true });
      }
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        sleepSync(LOCK_RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }
  return SESSION_STATE_LOCK_CONTENDED;
}
function errorCode(error) {
  if (!isRecord(error)) {
    return;
  }
  return Reflect.get(error, "code");
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function sleepSync(milliseconds) {
  Atomics.wait(LOCK_SLEEP_VIEW, 0, 0, milliseconds);
}

// components/rules/src/persistent-cache.ts
function hydrateEngineState(engine, cachePath) {
  const state = readSessionState(cachePath);
  engine.state.staticDedup.clear();
  engine.state.dynamicDedup.clear();
  engine.state.dynamicTargetFingerprints.clear();
  for (const key of state.staticDedup) {
    engine.state.staticDedup.add(key);
  }
  for (const [scope, keys] of Object.entries(state.dynamicDedup)) {
    engine.state.dynamicDedup.set(scope, new Set(keys));
  }
  for (const [targetKey, fingerprint] of Object.entries(state.dynamicTargetFingerprints ?? {})) {
    engine.state.dynamicTargetFingerprints.set(targetKey, fingerprint);
  }
}
function persistEngineState(engine, cachePath, completedPostCompactKind) {
  const currentState = readSessionState(cachePath);
  const dynamicDedup = {};
  for (const [scope, keys] of engine.state.dynamicDedup.entries()) {
    dynamicDedup[scope] = [...keys];
  }
  const postCompactPending = nextPostCompactPending(currentState, completedPostCompactKind);
  const postCompactRecovering = nextPostCompactRecovering(currentState, completedPostCompactKind);
  writeSessionState(cachePath, {
    staticDedup: [...engine.state.staticDedup],
    dynamicDedup,
    dynamicTargetFingerprints: Object.fromEntries(engine.state.dynamicTargetFingerprints.entries()),
    ...postCompactPending === undefined ? {} : { postCompactPending },
    ...postCompactRecovering === undefined ? {} : { postCompactRecovering }
  });
}
function clearSessionState(cachePath) {
  rmSync2(cachePath, { force: true });
}
function markSessionCompacted(cachePath) {
  const state = readSessionState(cachePath);
  writeSessionState(cachePath, {
    staticDedup: [],
    dynamicDedup: state.dynamicDedup,
    ...state.dynamicTargetFingerprints === undefined ? {} : { dynamicTargetFingerprints: state.dynamicTargetFingerprints },
    postCompactPending: { static: true, dynamic: true }
  });
}
function hasPostCompactPending(cachePath) {
  const state = readSessionState(cachePath);
  return postCompactPendingKinds(state).size > 0 || postCompactRecoveringKinds(state).size > 0;
}
function claimPostCompactPending(cachePath, kind) {
  const result = withSessionStateLock(cachePath, () => {
    const state = readSessionState(cachePath);
    const pendingKinds = postCompactPendingKinds(state);
    if (!pendingKinds.has(kind)) {
      return "not-pending";
    }
    pendingKinds.delete(kind);
    const recoveringKinds = postCompactRecoveringKinds(state);
    recoveringKinds.add(kind);
    writeSessionState(cachePath, stateWithPostCompactKinds(state, pendingKinds, recoveringKinds));
    return "claimed";
  });
  return result === SESSION_STATE_LOCK_CONTENDED ? "contended" : result;
}
function isPostCompactRecoveryInProgress(cachePath, kind) {
  return postCompactRecoveringKinds(readSessionState(cachePath)).has(kind);
}
function completePostCompactRecovery(cachePath, kind) {
  withSessionStateLock(cachePath, () => {
    const state = readSessionState(cachePath);
    const pendingKinds = postCompactPendingKinds(state);
    const recoveringKinds = postCompactRecoveringKinds(state);
    recoveringKinds.delete(kind);
    writeSessionState(cachePath, stateWithPostCompactKinds(state, pendingKinds, recoveringKinds));
  });
}
function sessionCachePath(sessionId, pluginDataRoot) {
  const root = pluginDataRoot ?? process.env["PLUGIN_DATA"] ?? join6(homedir2(), ".codex", "codex-rules");
  return join6(root, "sessions", `${safePathSegment(sessionId)}.json`);
}
function readSessionState(cachePath) {
  try {
    const parsed = JSON.parse(readFileSync2(cachePath, "utf8"));
    if (!isSerializedSessionState(parsed))
      return emptyState();
    return parsed;
  } catch {
    return emptyState();
  }
}
function writeSessionState(cachePath, state) {
  mkdirSync2(dirname6(cachePath), { recursive: true });
  writeFileSync(cachePath, `${JSON.stringify(state)}
`);
}
function emptyState() {
  return { staticDedup: [], dynamicDedup: {}, dynamicTargetFingerprints: {} };
}
function nextPostCompactPending(state, completedKind) {
  const pendingKinds = postCompactPendingKinds(state);
  if (completedKind !== undefined) {
    pendingKinds.delete(completedKind);
  }
  if (pendingKinds.size === 0) {
    return;
  }
  return {
    ...pendingKinds.has("static") ? { static: true } : {},
    ...pendingKinds.has("dynamic") ? { dynamic: true } : {}
  };
}
function nextPostCompactRecovering(state, completedKind) {
  const recoveringKinds = postCompactRecoveringKinds(state);
  if (completedKind !== undefined) {
    recoveringKinds.delete(completedKind);
  }
  return postCompactKindState(recoveringKinds);
}
function stateWithPostCompactKinds(state, pendingKinds, recoveringKinds) {
  const postCompactPending = postCompactKindState(pendingKinds);
  const postCompactRecovering = postCompactKindState(recoveringKinds);
  return {
    staticDedup: state.staticDedup,
    dynamicDedup: state.dynamicDedup,
    ...state.dynamicTargetFingerprints === undefined ? {} : { dynamicTargetFingerprints: state.dynamicTargetFingerprints },
    ...postCompactPending === undefined ? {} : { postCompactPending },
    ...postCompactRecovering === undefined ? {} : { postCompactRecovering }
  };
}
function safePathSegment(value) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "unknown-session";
}
function isSerializedSessionState(value) {
  if (!isRecord2(value) || !Array.isArray(value["staticDedup"]) || !isRecord2(value["dynamicDedup"])) {
    return false;
  }
  const staticDedup = value["staticDedup"];
  const dynamicDedup = value["dynamicDedup"];
  const dynamicTargetFingerprints = value["dynamicTargetFingerprints"];
  const postCompactPending = value["postCompactPending"];
  const postCompactRecovering = value["postCompactRecovering"];
  const compacted = value["compacted"];
  return staticDedup.every((item) => typeof item === "string") && Object.values(dynamicDedup).every((item) => Array.isArray(item) && item.every((nestedItem) => typeof nestedItem === "string")) && (dynamicTargetFingerprints === undefined || isRecord2(dynamicTargetFingerprints) && Object.entries(dynamicTargetFingerprints).every(([targetKey, fingerprint]) => typeof targetKey === "string" && typeof fingerprint === "string")) && (postCompactPending === undefined || isPostCompactPendingState(postCompactPending)) && (postCompactRecovering === undefined || isPostCompactPendingState(postCompactRecovering)) && (compacted === undefined || typeof compacted === "boolean");
}
function isPostCompactPendingState(value) {
  return isRecord2(value) && (value["static"] === undefined || typeof value["static"] === "boolean") && (value["dynamic"] === undefined || typeof value["dynamic"] === "boolean");
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// components/rules/src/transcript-search.ts
import { readFileSync as readFileSync3 } from "node:fs";
function readTranscriptSearchText(transcriptPath, options = {}) {
  try {
    const rawTranscript = readFileSync3(transcriptPath, "utf8");
    if (options.latestCompactedReplacementOnly === true) {
      return latestCompactedReplacementSearchText(rawTranscript);
    }
    return [rawTranscript, ...collectJsonLineStrings(rawTranscript)].join(`
`);
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return null;
  }
}
function latestCompactedReplacementSearchText(rawTranscript) {
  const lines = rawTranscript.split(/\r?\n/);
  let latestCompactedLineIndex = -1;
  let replacementHistory = null;
  for (const [index, line] of lines.entries()) {
    const parsed = parseJsonLine(line);
    if (!isRecord3(parsed) || parsed["type"] !== "compacted") {
      continue;
    }
    const payload = parsed["payload"];
    if (!isRecord3(payload)) {
      continue;
    }
    const candidateReplacementHistory = payload["replacement_history"];
    if (!Array.isArray(candidateReplacementHistory)) {
      continue;
    }
    latestCompactedLineIndex = index;
    replacementHistory = candidateReplacementHistory;
  }
  if (replacementHistory === null) {
    return null;
  }
  const values = [];
  collectStrings(replacementHistory, values);
  const laterTranscript = lines.slice(latestCompactedLineIndex + 1).join(`
`);
  values.push(laterTranscript, ...collectJsonLineStrings(laterTranscript));
  return values.join(`
`);
}
function collectJsonLineStrings(rawTranscript) {
  const values = [];
  for (const line of rawTranscript.split(/\r?\n/)) {
    const parsed = parseJsonLine(line);
    if (parsed !== null) {
      collectStrings(parsed, values);
    }
  }
  return values;
}
function parseJsonLine(line) {
  if (line.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(line);
    return parsed;
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return null;
  }
}
function collectStrings(value, output) {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, output);
    }
    return;
  }
  if (!isRecord3(value)) {
    return;
  }
  for (const item of Object.values(value)) {
    collectStrings(item, output);
  }
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// components/rules/src/post-compact-budget.ts
var DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT = 95;
var ESTIMATED_TRANSCRIPT_CHARS_PER_TOKEN = 3;
var PROJECTED_INJECTION_CHARS_PER_TOKEN = 2;
var POST_COMPACT_RESERVED_CONTEXT_PERCENT = 5;
var POST_COMPACT_MIN_RESERVED_TOKENS = 8000;
var POST_COMPACT_MIN_GUIDE_CHARS = 500;
var FALLBACK_CONTEXT_WINDOW_TOKENS = 200000;
var MODEL_CONTEXT_BUDGETS = [
  { slug: "gpt-5.6-sol", contextWindowTokens: 650000, effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT },
  {
    slug: "gpt-5.6-terra",
    contextWindowTokens: 650000,
    effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT
  },
  {
    slug: "gpt-5.6-luna",
    contextWindowTokens: 650000,
    effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT
  },
  { slug: "gpt-5.5", contextWindowTokens: 272000, effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT },
  {
    slug: "gpt-5.6-luna-fast",
    contextWindowTokens: 272000,
    effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT
  },
  {
    slug: "codex-auto-review",
    contextWindowTokens: 272000,
    effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT
  }
];
function withPostCompactBudget(config, context) {
  const postCompactMaxResultChars = dynamicPostCompactMaxResultChars(context) ?? config.postCompactMaxResultChars;
  const maxResultChars = Math.min(config.maxResultChars, config.postCompactMaxResultChars, postCompactMaxResultChars);
  const maxRuleChars = Math.min(config.maxRuleChars, config.postCompactMaxRuleChars, maxResultChars);
  return {
    ...config,
    maxRuleChars,
    maxResultChars
  };
}
function dynamicPostCompactMaxResultChars(context) {
  if (context === undefined || context.transcriptPath === null) {
    return;
  }
  const transcript = estimateTranscript(context.transcriptPath);
  if (transcript === undefined) {
    return;
  }
  if (hasContextPressureMarker(transcript.text)) {
    return POST_COMPACT_MIN_GUIDE_CHARS;
  }
  const modelBudget = modelContextBudgetFor(context.model) ?? fallbackModelContextBudget();
  const effectiveContextWindow = Math.floor(modelBudget.contextWindowTokens * modelBudget.effectivePercent / 100);
  const reservedTokens = Math.max(POST_COMPACT_MIN_RESERVED_TOKENS, Math.floor(effectiveContextWindow * POST_COMPACT_RESERVED_CONTEXT_PERCENT / 100));
  const injectableTokens = Math.max(0, effectiveContextWindow - reservedTokens - transcript.tokens);
  return Math.max(POST_COMPACT_MIN_GUIDE_CHARS, Math.floor(injectableTokens * PROJECTED_INJECTION_CHARS_PER_TOKEN));
}
function modelContextBudgetFor(model) {
  const normalizedModel = model.trim().toLowerCase();
  for (const budget of MODEL_CONTEXT_BUDGETS) {
    if (normalizedModel === budget.slug || normalizedModel.endsWith(`.${budget.slug}`) || normalizedModel.endsWith(`/${budget.slug}`)) {
      return budget;
    }
  }
  return;
}
function fallbackModelContextBudget() {
  return {
    slug: "unknown",
    contextWindowTokens: FALLBACK_CONTEXT_WINDOW_TOKENS,
    effectivePercent: DEFAULT_EFFECTIVE_CONTEXT_WINDOW_PERCENT
  };
}
function estimateTranscript(transcriptPath) {
  const transcriptText = readTranscriptSearchText(transcriptPath, { latestCompactedReplacementOnly: true }) ?? readTranscriptSearchText(transcriptPath);
  if (transcriptText === null) {
    return;
  }
  return {
    text: transcriptText,
    tokens: Math.ceil(Buffer.byteLength(transcriptText, "utf8") / ESTIMATED_TRANSCRIPT_CHARS_PER_TOKEN)
  };
}

// components/rules/src/post-compact-claim.ts
function claimedPostCompactKind(result, kind) {
  return result === "claimed" ? kind : undefined;
}
function shouldSkipPostCompactClaim(result, recoveryInProgress) {
  return result === "contended" || result === "not-pending" && recoveryInProgress;
}

// components/rules/src/rules-engine-factory.ts
import { readFileSync as readFileSync4 } from "node:fs";
import { dirname as dirname7 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var componentRoot = dirname7(dirname7(fileURLToPath2(import.meta.url)));
function createRulesEngine(options, config = configFromEnvironment(options.env), model) {
  const platform = options.platform ?? process.platform;
  const pluginRoot = options.env?.["PLUGIN_ROOT"] ?? process.env["PLUGIN_ROOT"] ?? componentRoot;
  return createEngine(config, {
    findCandidates: (finderOptions) => findRuleCandidates({ ...finderOptions, platform, pluginRoot, ...model === undefined ? {} : { model } }),
    findProjectRoot,
    readFile: (path) => {
      try {
        return readFileSync4(path, "utf8");
      } catch {
        return null;
      }
    }
  });
}

// components/rules/src/static-injection.ts
import { existsSync as existsSync4 } from "node:fs";

// components/rules/src/post-compact-directive.ts
var DIRECTIVE_HEADER = [
  "## MANDATORY: POST-COMPACTION RULE RECOVERY",
  "",
  "Context compaction DROPPED the project rule files listed below from your context.",
  "YOU MUST READ THE FOLLOWING RULES with your file-reading tool RIGHT NOW, BEFORE ANY OTHER ACTION. NO EXCUSES.",
  "Do not plan, answer, edit, or run anything until EVERY file below has been read end to end:",
  ""
].join(`
`);
var DIRECTIVE_FOOTER = `
Operating without these rules is a protocol violation. Reconstructing them from memory is NOT reading. READ THEM ALL. NO EXCUSES.`;
function buildPostCompactReadDirective(rulePaths, maxChars) {
  const paths = uniqueStrings2([...rulePaths]);
  if (paths.length === 0) {
    return "";
  }
  const lines = [];
  let usedChars = DIRECTIVE_HEADER.length + DIRECTIVE_FOOTER.length;
  let omittedCount = 0;
  for (const rulePath of paths) {
    const line = `- ${rulePath}`;
    if (lines.length > 0 && usedChars + line.length + 1 > maxChars) {
      omittedCount += 1;
      continue;
    }
    lines.push(line);
    usedChars += line.length + 1;
  }
  if (omittedCount > 0) {
    lines.push(`- (+${omittedCount} more rule files omitted - rescan the project rule directories and read those too)`);
  }
  return `${DIRECTIVE_HEADER}${lines.join(`
`)}${DIRECTIVE_FOOTER}`;
}

// components/rules/src/transcript-rule-filter.ts
function filterRulesAlreadyInTranscript(rules, transcriptPath, markInjected, options = {}) {
  if (rules.length === 0 || transcriptPath === null) {
    return [...rules];
  }
  const transcriptText = readTranscriptSearchText(transcriptPath, options);
  return filterRulesNotInTranscriptText(rules, transcriptText, markInjected);
}
function filterRulesNotInTranscriptText(rules, transcriptText, markInjected) {
  if (rules.length === 0 || transcriptText === null) {
    return [...rules];
  }
  const pendingRules = [];
  for (const rule of rules) {
    if (isRuleAlreadyInTranscript(rule, transcriptText)) {
      markInjected(rule);
      continue;
    }
    pendingRules.push(rule);
  }
  return pendingRules;
}
function isRuleAlreadyInTranscript(rule, transcriptText) {
  const staticReferenceNeedles = [
    `- [${displayFilename(rule)}]{${rule.path}}`,
    `- [${displayFilename(rule)}]{${rule.realPath}}`
  ];
  if (staticReferenceNeedles.some((needle) => transcriptText.includes(needle))) {
    return true;
  }
  const bodyNeedle = rule.body.trim().slice(0, 2000);
  if (bodyNeedle.length === 0 || !transcriptText.includes(bodyNeedle)) {
    return false;
  }
  const markers = [
    `Instructions from: ${rule.path}`,
    `Instructions from: ${rule.realPath}`,
    rule.relativePath.length === 0 ? null : rule.relativePath
  ].filter((marker) => marker !== null);
  return markers.some((marker) => transcriptText.includes(marker));
}
function displayFilename(rule) {
  const normalizedPath = rule.relativePath.length > 0 ? rule.relativePath : rule.path;
  const segments = normalizedPath.replace(/\\/g, "/").split("/").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? normalizedPath;
}

// components/rules/src/static-injection.ts
function runStaticInjection(cwd, transcriptPath, eventName, cachePath, options, completedPostCompactChannel, transcriptSearchOptions = {}, model) {
  const config = configFromEnvironment(options.env);
  if (config.disabled || config.mode === "off" || config.mode === "dynamic") {
    if (completedPostCompactChannel !== undefined) {
      completePostCompactRecovery(cachePath, completedPostCompactChannel);
    }
    return "";
  }
  if (completedPostCompactChannel !== undefined) {
    return runPostCompactRecovery({
      cwd,
      transcriptPath,
      eventName,
      cachePath,
      options,
      channel: completedPostCompactChannel,
      model: model ?? "",
      config
    });
  }
  const effectiveConfig = eventName === "UserPromptSubmit" ? withPromptBudget(config) : config;
  const engine = createRulesEngine(options, effectiveConfig, model);
  hydrateEngineState(engine, cachePath);
  engine.state.cwd = cwd;
  const loaded = engine.loadStaticRules(cwd);
  const rules = filterRulesAlreadyInTranscript(loaded.rules.filter((rule) => !engine.isStaticInjected(rule)), transcriptPath, (rule) => {
    engine.markStaticInjected(rule);
  }, transcriptSearchOptions);
  if (rules.length === 0) {
    persistEngineState(engine, cachePath);
    return "";
  }
  const block = engine.formatStatic(rules);
  for (const rule of rules) {
    engine.markStaticInjected(rule);
  }
  persistEngineState(engine, cachePath);
  return formatAdditionalContextOutput(eventName, block);
}
function runPostCompactRecovery(input) {
  const effectiveConfig = withPostCompactBudget(input.config, {
    model: input.model,
    transcriptPath: input.transcriptPath
  });
  const engine = createRulesEngine(input.options, effectiveConfig, input.model);
  hydrateEngineState(engine, input.cachePath);
  engine.state.cwd = input.cwd;
  const loaded = engine.loadStaticRules(input.cwd);
  const transcriptText = readRecoveryTranscriptText(input.transcriptPath);
  const missingRules = filterRulesNotInTranscriptText(loaded.rules.filter((rule) => !engine.isStaticInjected(rule)), transcriptText, (rule) => {
    engine.markStaticInjected(rule);
  });
  const dynamicRulePaths = recoverDynamicRulePaths(engine, transcriptText, loaded.rules);
  if (missingRules.length === 0 && dynamicRulePaths.length === 0) {
    persistEngineState(engine, input.cachePath, input.channel);
    return "";
  }
  const fullBodyRules = missingRules.filter((rule) => isNeverTruncatedRule(ruleDisplayPath(rule)));
  const listedRules = missingRules.filter((rule) => !isNeverTruncatedRule(ruleDisplayPath(rule)));
  const bodyBlock = fullBodyRules.length === 0 ? "" : engine.formatStatic(fullBodyRules);
  const directive = buildPostCompactReadDirective([...listedRules.map((rule) => rule.path), ...dynamicRulePaths], effectiveConfig.maxResultChars);
  for (const rule of missingRules) {
    engine.markStaticInjected(rule);
  }
  persistEngineState(engine, input.cachePath, input.channel);
  return formatAdditionalContextOutput(input.eventName, combineStaticContext(bodyBlock, directive));
}
function readRecoveryTranscriptText(transcriptPath) {
  if (transcriptPath === null) {
    return null;
  }
  return readTranscriptSearchText(transcriptPath, { latestCompactedReplacementOnly: true }) ?? readTranscriptSearchText(transcriptPath);
}
function recoverDynamicRulePaths(engine, transcriptText, staticRules) {
  const staticRulePaths = new Set(staticRules.map((rule) => rule.realPath));
  const recoveredPaths = new Set;
  for (const dedupKeys of engine.state.dynamicDedup.values()) {
    for (const dedupKey of dedupKeys) {
      const separatorIndex = dedupKey.lastIndexOf("::");
      if (separatorIndex <= 0) {
        continue;
      }
      const rulePath = dedupKey.slice(0, separatorIndex);
      if (staticRulePaths.has(rulePath)) {
        continue;
      }
      if (transcriptText?.includes(rulePath)) {
        continue;
      }
      if (!existsSync4(rulePath)) {
        continue;
      }
      recoveredPaths.add(rulePath);
    }
  }
  return [...recoveredPaths].sort();
}
function ruleDisplayPath(rule) {
  return rule.relativePath.length > 0 ? rule.relativePath : rule.path;
}
function combineStaticContext(...blocks) {
  return blocks.filter((block) => block.trim().length > 0).join(`

`);
}

// components/rules/src/tool-paths.ts
import { existsSync as existsSync5, statSync as statSync6 } from "node:fs";
import { isAbsolute as isAbsolute4, resolve as resolve10 } from "node:path";
var COMMAND_TOOL_NAMES = new Set(["bash", "shell_command", "exec_command"]);
var TRACKED_TOOL_NAMES = new Set([
  "read",
  "read_file",
  "mcp__filesystem__read_file",
  "mcp__filesystem__read_multiple_files",
  "mcp__filesystem__write_file",
  "mcp__filesystem__edit_file",
  "write",
  "edit",
  "multiedit",
  "multi_edit",
  "apply_patch",
  "bash",
  "shell_command",
  "exec_command"
]);
function extractCodexToolPaths(input, cwd) {
  const toolName = input.tool_name.toLowerCase();
  if (!TRACKED_TOOL_NAMES.has(toolName) || isFailedToolResponse(input.tool_response)) {
    return [];
  }
  const paths = new Set;
  const toolInput = isRecord4(input.tool_input) ? input.tool_input : {};
  addCommonPathFields(paths, toolInput, cwd);
  addPatchPayloadPaths(paths, toolInput, cwd);
  addPatchRecordPaths(paths, toolInput["files"], cwd);
  addPatchRecordPaths(paths, toolInput["changes"], cwd);
  if (COMMAND_TOOL_NAMES.has(toolName)) {
    const command = stringProperty(toolInput, "command") ?? stringProperty(toolInput, "cmd");
    const workdir = stringProperty(toolInput, "workdir") ?? stringProperty(toolInput, "cwd");
    addCommandPaths(paths, command, workdir === undefined ? cwd : resolvePath(cwd, workdir));
  }
  return [...paths];
}
function addCommonPathFields(paths, input, cwd) {
  for (const key of ["path", "filePath", "file_path", "target", "targetPath", "target_path"]) {
    addPath(paths, input[key], cwd, false);
  }
  for (const key of ["paths", "filePaths", "file_paths"]) {
    addPathArray(paths, input[key], cwd, false);
  }
}
function addPatchPayloadPaths(paths, input, cwd) {
  for (const key of ["input", "patch", "command", "cmd"]) {
    const value = input[key];
    if (typeof value === "string") {
      addPatchHeaderPaths(paths, value, cwd);
    }
  }
}
function addPatchHeaderPaths(paths, patch, cwd) {
  for (const line of patch.split(`
`)) {
    for (const prefix of ["*** Add File: ", "*** Update File: ", "*** Move to: "]) {
      if (line.startsWith(prefix)) {
        addPath(paths, line.slice(prefix.length).trim(), cwd, false);
      }
    }
  }
}
function addPatchRecordPaths(paths, value, cwd) {
  if (!Array.isArray(value))
    return;
  for (const item of value) {
    if (typeof item === "string") {
      addPath(paths, item, cwd, false);
      continue;
    }
    if (!isRecord4(item))
      continue;
    addCommonPathFields(paths, item, cwd);
    for (const key of ["movePath", "move_path", "to", "from"]) {
      addPath(paths, item[key], cwd, false);
    }
  }
}
function addCommandPaths(paths, command, cwd) {
  if (command === undefined)
    return;
  for (const token of tokenizeShell(command)) {
    if (token.length === 0 || token.startsWith("-") || token.includes("*")) {
      continue;
    }
    addPath(paths, token, cwd, true);
  }
}
function addPathArray(paths, value, cwd, mustExist) {
  if (!Array.isArray(value))
    return;
  for (const item of value) {
    addPath(paths, item, cwd, mustExist);
  }
}
function addPath(paths, value, cwd, mustExist) {
  if (typeof value !== "string" || value.length === 0 || looksLikeUrl(value)) {
    return;
  }
  const path = resolvePath(cwd, value);
  if (mustExist && !isExistingFile(path)) {
    return;
  }
  paths.add(path);
}
function resolvePath(cwd, filePath) {
  return isAbsolute4(filePath) ? filePath : resolve10(cwd, filePath);
}
function isExistingFile(filePath) {
  try {
    return existsSync5(filePath) && statSync6(filePath).isFile();
  } catch {
    return false;
  }
}
function looksLikeUrl(value) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value);
}
function stringProperty(value, key) {
  const property = value[key];
  return typeof property === "string" && property.length > 0 ? property : undefined;
}
function tokenizeShell(command) {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (const character of command) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if ((character === "'" || character === '"') && quote === null) {
      quote = character;
      continue;
    }
    if (quote === character) {
      quote = null;
      continue;
    }
    if (quote === null && /\s/.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isFailedToolResponse(value) {
  if (!isRecord4(value))
    return false;
  return value["isError"] === true || value["is_error"] === true || value["error"] === true || value["status"] === "error";
}

// components/rules/src/codex-hook.ts
async function runSessionStartHook(input, options = {}) {
  const cachePath = sessionCachePath(input.session_id, options.pluginDataRoot);
  if (input.source === "clear") {
    clearSessionState(cachePath);
  } else if (input.source !== "resume" && input.source !== "compact" && !hasPostCompactPending(cachePath)) {
    clearSessionState(cachePath);
  }
  const postCompactClaim = input.source === "clear" ? "not-pending" : claimPostCompactPending(cachePath, "static");
  const completedPostCompactKind = claimedPostCompactKind(postCompactClaim, "static") ?? (input.source === "compact" && postCompactClaim === "not-pending" ? "static" : undefined);
  if (shouldSkipPostCompactClaim(postCompactClaim, input.source === "compact" && isPostCompactRecoveryInProgress(cachePath, "static"))) {
    return "";
  }
  const transcriptPath = input.source === "clear" ? null : input.transcript_path;
  return runStaticInjection(input.cwd, transcriptPath, "SessionStart", cachePath, options, completedPostCompactKind, { latestCompactedReplacementOnly: completedPostCompactKind !== undefined }, input.model);
}
async function runPostCompactHook(input, options = {}) {
  markSessionCompacted(sessionCachePath(input.session_id, options.pluginDataRoot));
  return "";
}
async function runUserPromptSubmitHook(input, options = {}) {
  if (hasContextPressureMarker(input.prompt)) {
    return "";
  }
  const cachePath = sessionCachePath(input.session_id, options.pluginDataRoot);
  const postCompactClaim = claimPostCompactPending(cachePath, "static");
  if (postCompactClaim === "not-pending" && transcriptHasContextPressureMarker(input.transcript_path)) {
    return "";
  }
  const completedPostCompactKind = claimedPostCompactKind(postCompactClaim, "static");
  if (shouldSkipPostCompactClaim(postCompactClaim, isPostCompactRecoveryInProgress(cachePath, "static"))) {
    return "";
  }
  return runStaticInjection(input.cwd, input.transcript_path, "UserPromptSubmit", cachePath, options, completedPostCompactKind, { latestCompactedReplacementOnly: completedPostCompactKind !== undefined }, input.model);
}
async function runPostToolUseHook(input, options = {}) {
  const debugTimer = createHookDebugTimer("PostToolUse");
  const config = configFromEnvironment(options.env);
  debugTimer.lap("config", { disabled: config.disabled, mode: config.mode });
  if (config.disabled || config.mode === "off" || config.mode === "static") {
    debugTimer.done({ outputBytes: 0, reason: "disabled" });
    return "";
  }
  const targetPaths = extractCodexToolPaths(input, input.cwd);
  debugTimer.lap("extract", {
    targets: targetPaths.length,
    uniqueTargets: uniqueStrings2(targetPaths).length,
    tool: input.tool_name
  });
  const firstTargetPath = targetPaths[0];
  if (firstTargetPath === undefined) {
    debugTimer.done({ outputBytes: 0, reason: "no-target" });
    return "";
  }
  const cachePath = sessionCachePath(input.session_id, options.pluginDataRoot);
  const postCompactClaim = claimPostCompactPending(cachePath, "dynamic");
  if (postCompactClaim === "not-pending" && transcriptHasContextPressureMarker(input.transcript_path)) {
    debugTimer.done({ outputBytes: 0, reason: "context-pressure-transcript" });
    return "";
  }
  const completedPostCompactKind = claimedPostCompactKind(postCompactClaim, "dynamic");
  if (shouldSkipPostCompactClaim(postCompactClaim, isPostCompactRecoveryInProgress(cachePath, "dynamic"))) {
    debugTimer.done({ outputBytes: 0, reason: "post-compact-recovery-in-progress" });
    return "";
  }
  const dynamicConfig = withDynamicBudget(config);
  const engine = createRulesEngine(options, completedPostCompactKind !== undefined ? withPostCompactBudget(dynamicConfig, { model: input.model, transcriptPath: input.transcript_path }) : dynamicConfig, input.model);
  hydrateEngineState(engine, cachePath);
  debugTimer.lap("hydrate", {
    dynamicDedupScopes: engine.state.dynamicDedup.size,
    dynamicTargetFingerprints: engine.state.dynamicTargetFingerprints.size,
    staticDedup: engine.state.staticDedup.size
  });
  const dynamicTargetFingerprints = fingerprintDynamicTargets(input.cwd, targetPaths, config, input.model);
  debugTimer.lap("fingerprint", { fingerprints: dynamicTargetFingerprints.length });
  const pendingTargetFingerprints = dynamicTargetFingerprints.filter((target) => engine.state.dynamicTargetFingerprints.get(target.cacheKey) !== target.fingerprint);
  debugTimer.lap("pending", { pending: pendingTargetFingerprints.length });
  if (pendingTargetFingerprints.length === 0) {
    persistEngineState(engine, cachePath, completedPostCompactKind);
    debugTimer.lap("persist", { reason: "no-pending" });
    debugTimer.done({ outputBytes: 0, reason: "no-pending" });
    return "";
  }
  const loaded = engine.loadDynamicRules(input.cwd, pendingTargetFingerprints.map((target) => target.targetPath));
  debugTimer.lap("load", { diagnostics: loaded.diagnostics.length, loadedRules: loaded.rules.length });
  const rules = filterRulesAlreadyInTranscript(loaded.rules.filter((rule) => !engine.isStaticInjected(rule) && !engine.isDynamicInjected(rule)), input.transcript_path, (rule) => {
    engine.markDynamicInjected(rule);
  }, { latestCompactedReplacementOnly: completedPostCompactKind !== undefined });
  debugTimer.lap("filter", { rules: rules.length });
  for (const target of pendingTargetFingerprints) {
    engine.state.dynamicTargetFingerprints.set(target.cacheKey, target.fingerprint);
  }
  if (rules.length === 0) {
    persistEngineState(engine, cachePath, completedPostCompactKind);
    debugTimer.lap("persist", { reason: "no-rules" });
    debugTimer.done({ outputBytes: 0, reason: "no-rules" });
    return "";
  }
  const firstPendingTargetPath = pendingTargetFingerprints[0]?.targetPath ?? firstTargetPath;
  const block = engine.formatDynamic(rules, displayPath(input.cwd, firstPendingTargetPath));
  debugTimer.lap("format", { blockChars: block.length, rules: rules.length });
  for (const rule of rules) {
    engine.markDynamicInjected(rule);
  }
  persistEngineState(engine, cachePath, completedPostCompactKind);
  debugTimer.lap("persist", { reason: "emit" });
  const output = formatAdditionalContextOutput("PostToolUse", block);
  debugTimer.done({ outputBytes: Buffer.byteLength(output), reason: "emit" });
  return output;
}

// components/rules/src/cli.ts
var command = process.argv[2];
var subcommand = process.argv[3];
if (command === "hook" && subcommand === "session-start") {
  await runHookCli("SessionStart");
} else if (command === "hook" && subcommand === "user-prompt-submit") {
  await runHookCli("UserPromptSubmit");
} else if (command === "hook" && subcommand === "post-tool-use") {
  await runHookCli("PostToolUse");
} else if (command === "hook" && subcommand === "post-compact") {
  await runHookCli("PostCompact");
} else {
  process.stderr.write(`Usage: omo-rules hook [session-start|user-prompt-submit|post-tool-use|post-compact]
`);
  process.exitCode = 1;
}
async function runHookCli(eventName) {
  const raw = await readStdin();
  if (raw.trim().length === 0)
    return;
  const parsed = parseHookInput(raw);
  if (!parsed)
    return;
  const pluginDataRoot = process.env["PLUGIN_DATA"];
  const options = pluginDataRoot === undefined ? {} : { pluginDataRoot };
  const output = await runHook(eventName, parsed, options);
  await writeStdout(output);
}
async function runHook(eventName, parsed, options) {
  switch (eventName) {
    case "SessionStart":
      return isCodexSessionStartInput(parsed) ? await runSessionStartHook(parsed, options) : "";
    case "UserPromptSubmit":
      return isCodexUserPromptSubmitInput(parsed) ? await runUserPromptSubmitHook(parsed, options) : "";
    case "PostToolUse":
      return isCodexPostToolUseInput(parsed) ? await runPostToolUseHook(parsed, options) : "";
    case "PostCompact":
      return isCodexPostCompactInput(parsed) ? await runPostCompactHook(parsed, options) : "";
  }
}
function parseHookInput(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return;
  }
}
function isCodexSessionStartInput(value) {
  return isRecord5(value) && value["hook_event_name"] === "SessionStart" && typeof value["session_id"] === "string" && isStringOrNull(value["transcript_path"]) && typeof value["cwd"] === "string" && typeof value["model"] === "string" && typeof value["permission_mode"] === "string" && typeof value["source"] === "string";
}
function isCodexUserPromptSubmitInput(value) {
  return isRecord5(value) && value["hook_event_name"] === "UserPromptSubmit" && typeof value["session_id"] === "string" && typeof value["turn_id"] === "string" && isStringOrNull(value["transcript_path"]) && typeof value["cwd"] === "string" && typeof value["model"] === "string" && typeof value["permission_mode"] === "string" && typeof value["prompt"] === "string";
}
function isCodexPostToolUseInput(value) {
  return isRecord5(value) && value["hook_event_name"] === "PostToolUse" && typeof value["session_id"] === "string" && typeof value["turn_id"] === "string" && isStringOrNull(value["transcript_path"]) && typeof value["cwd"] === "string" && typeof value["model"] === "string" && typeof value["permission_mode"] === "string" && typeof value["tool_name"] === "string" && typeof value["tool_use_id"] === "string";
}
function isCodexPostCompactInput(value) {
  return isRecord5(value) && value["hook_event_name"] === "PostCompact" && typeof value["session_id"] === "string" && typeof value["turn_id"] === "string" && isStringOrNull(value["transcript_path"]) && typeof value["cwd"] === "string" && typeof value["model"] === "string" && (value["trigger"] === "manual" || value["trigger"] === "auto");
}
function isStringOrNull(value) {
  return typeof value === "string" || value === null;
}
function isRecord5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function readStdin() {
  return new Promise((resolve11, reject) => {
    let data = "";
    processStdin.setEncoding("utf8");
    processStdin.on("data", (chunk) => {
      data += chunk;
    });
    processStdin.once("error", reject);
    processStdin.once("end", () => {
      processStdin.pause();
      resolve11(data);
    });
    processStdin.resume();
  });
}
function writeStdout(output) {
  if (output.length === 0)
    return Promise.resolve();
  return new Promise((resolve11, reject) => {
    processStdout.write(output, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve11();
    });
  });
}
