import type { ClauseBoundary } from "./types";

const sentenceTerminators = new Set([".", "!", "?", "…"]);
const pauseTerminators = new Set([",", ";"]);

function isBoundaryFollower(value: string | undefined): boolean {
  return value === undefined || /\s/u.test(value);
}

export function detectClauseBoundary(text: string, mode: ClauseBoundary = "sentence-end"): number {
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === undefined) {
      continue;
    }

    if (mode === "comma-pause" && pauseTerminators.has(char)) {
      return index;
    }

    if (!sentenceTerminators.has(char)) {
      continue;
    }

    let end = index + 1;
    while (sentenceTerminators.has(text[end] ?? "")) {
      end += 1;
    }

    if (isBoundaryFollower(text[end])) {
      return end;
    }
  }

  return -1;
}
