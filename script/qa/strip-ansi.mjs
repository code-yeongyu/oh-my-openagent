// Strip ANSI SGR and OSC control sequences from a terminal byte stream, leaving
// plain readable text. Used for the text-evidence artifact and the chrome-less
// fallback capture.

const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const OSC_PATTERN = /\u001b\][\s\S]*?(?:\u0007|\u001b\\|\u009c)/g;

export function stripAnsi(value) {
  return value.replace(OSC_PATTERN, "").replace(ANSI_PATTERN, "");
}
