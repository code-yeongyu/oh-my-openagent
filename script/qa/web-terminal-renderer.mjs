const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const OSC_PATTERN = /\u001b\][\s\S]*?(?:\u0007|\u001b\\|\u009c)/g;
const SGR_PATTERN = /\u001b\[([0-9;:]*)m/g;

const COLOR_NAMES = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
];

const BASIC_ANSI_COLORS = {
  black: "#0c0d10",
  red: "#ff6b6b",
  green: "#51cf66",
  yellow: "#ffd43b",
  blue: "#4dabf7",
  magenta: "#d0bfff",
  cyan: "#66d9e8",
  white: "#f1f3f5",
  "bright-black": "#868e96",
  "bright-red": "#ff8787",
  "bright-green": "#69db7c",
  "bright-yellow": "#ffe066",
  "bright-blue": "#74c0fc",
  "bright-magenta": "#e599f7",
  "bright-cyan": "#99e9f2",
  "bright-white": "#ffffff",
};

export const DEFAULT_TERMINAL_FOREGROUND = "#d8dee9";
export const DEFAULT_TERMINAL_BACKGROUND = "#090b10";

export function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function stripAnsi(value) {
  return value.replace(OSC_PATTERN, "").replace(ANSI_PATTERN, "");
}

function createState() {
  return {
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
    strike: false,
    fg: null,
    bg: null,
  };
}

function parseCodes(raw) {
  if (raw === "") return { values: [0], separators: [null] };
  const values = [];
  const separators = [];
  let separator = null;
  for (const part of raw.split(/([;:])/)) {
    if (part === ";" || part === ":") {
      separator = part;
      continue;
    }
    values.push(part === "" ? null : Number.parseInt(part, 10));
    separators.push(separator);
    separator = null;
  }
  return { values, separators };
}

function basicColor(code, base, brightBase, prefix) {
  if (code >= base && code < base + COLOR_NAMES.length) return `${prefix}-${COLOR_NAMES[code - base]}`;
  if (code >= brightBase && code < brightBase + COLOR_NAMES.length) {
    return `${prefix}-bright-${COLOR_NAMES[code - brightBase]}`;
  }
  return null;
}

function rgbFrom256(index) {
  if (index < 0 || index > 255) return null;
  if (index < 16) {
    const base = [
      "#000000",
      "#800000",
      "#008000",
      "#808000",
      "#000080",
      "#800080",
      "#008080",
      "#c0c0c0",
      "#808080",
      "#ff0000",
      "#00ff00",
      "#ffff00",
      "#0000ff",
      "#ff00ff",
      "#00ffff",
      "#ffffff",
    ];
    return base[index] ?? null;
  }
  if (index >= 232) {
    const level = 8 + (index - 232) * 10;
    return `rgb(${level}, ${level}, ${level})`;
  }
  const offset = index - 16;
  const levels = [0, 95, 135, 175, 215, 255];
  const r = levels[Math.floor(offset / 36) % 6] ?? 0;
  const g = levels[Math.floor(offset / 6) % 6] ?? 0;
  const b = levels[offset % 6] ?? 0;
  return `rgb(${r}, ${g}, ${b})`;
}

function readExtendedColor(codes, separators, index) {
  const mode = codes[index + 1];
  if (mode === 5) return { color: rgbFrom256(codes[index + 2] ?? -1), next: index + 3 };
  if (mode === 2) {
    const offset = separators[index + 1] === ":" && codes[index + 5] !== undefined ? 3 : 2;
    const [r, g, b] = [codes[index + offset], codes[index + offset + 1], codes[index + offset + 2]];
    if ([r, g, b].every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
      return { color: `rgb(${r}, ${g}, ${b})`, next: index + offset + 3 };
    }
  }
  return { color: null, next: index + 1 };
}

function applySgr(state, raw) {
  const { values: codes, separators } = parseCodes(raw);
  let nextState = { ...state };
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i] ?? 0;
    if (code === 0) nextState = createState();
    else if (code === 1) nextState.bold = true;
    else if (code === 2) nextState.dim = true;
    else if (code === 3) nextState.italic = true;
    else if (code === 4) nextState.underline = true;
    else if (code === 7) nextState.inverse = true;
    else if (code === 9) nextState.strike = true;
    else if (code === 22) {
      nextState.bold = false;
      nextState.dim = false;
    } else if (code === 23) nextState.italic = false;
    else if (code === 24) nextState.underline = false;
    else if (code === 27) nextState.inverse = false;
    else if (code === 29) nextState.strike = false;
    else if (code === 39) nextState.fg = null;
    else if (code === 49) nextState.bg = null;
    else if (code === 38 || code === 48) {
      const extended = readExtendedColor(codes, separators, i);
      if (code === 38) nextState.fg = extended.color;
      else nextState.bg = extended.color;
      i = extended.next - 1;
    } else {
      const fg = basicColor(code, 30, 90, "fg");
      const bg = basicColor(code, 40, 100, "bg");
      if (fg) nextState.fg = fg;
      if (bg) nextState.bg = bg;
    }
  }
  return nextState;
}

function spanAttributes(state) {
  const classes = [];
  const styles = [];
  if (state.bold) classes.push("ansi-bold");
  if (state.dim) classes.push("ansi-dim");
  if (state.italic) classes.push("ansi-italic");
  if (state.underline) classes.push("ansi-underline");
  if (state.strike) classes.push("ansi-strike");
  const effectiveFg = state.inverse ? state.bg || DEFAULT_TERMINAL_BACKGROUND : state.fg;
  const effectiveBg = state.inverse ? state.fg || DEFAULT_TERMINAL_FOREGROUND : state.bg;
  for (const [value, cssProperty, classPrefix] of [
    [effectiveFg, "color", "fg-"],
    [effectiveBg, "background-color", "bg-"],
  ]) {
    if (!value) continue;
    const colorName = value.match(/^(?:fg|bg)-(.+)$/)?.[1];
    if (colorName) classes.push(`ansi-${classPrefix}${colorName}`);
    else styles.push(`${cssProperty}: ${value}`);
  }
  const attrs = [];
  if (classes.length > 0) attrs.push(`class="${classes.join(" ")}"`);
  if (styles.length > 0) attrs.push(`style="${styles.join("; ")}"`);
  return attrs.join(" ");
}

function renderSegment(value, state) {
  const escaped = escapeHtml(value);
  const attrs = spanAttributes(state);
  return attrs ? `<span ${attrs}>${escaped}</span>` : escaped;
}

export function renderAnsiToHtml(value) {
  const cleanValue = value.replace(OSC_PATTERN, "");
  let state = createState();
  let cursor = 0;
  let output = "";
  for (const match of cleanValue.matchAll(SGR_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) output += renderSegment(cleanValue.slice(cursor, index), state);
    state = applySgr(state, match[1] ?? "");
    cursor = index + match[0].length;
  }
  if (cursor < cleanValue.length) output += renderSegment(cleanValue.slice(cursor), state);
  return output.replace(ANSI_PATTERN, "");
}

export function ansiColorCss() {
  return Object.entries(BASIC_ANSI_COLORS)
    .map(([name, value]) => `.ansi-fg-${name} { color: ${value}; }\n.ansi-bg-${name} { background-color: ${value}; }`)
    .join("\n");
}
