import { describe, expect, test } from "bun:test";
import { detectClauseBoundary } from "./clause-detector";

interface DetectorCase {
  name: string;
  text: string;
  mode: "sentence-end" | "comma-pause";
  expected: number;
}

describe("detectClauseBoundary", () => {
  const cases: DetectorCase[] = [
    { name: "empty string", text: "", mode: "sentence-end", expected: -1 },
    { name: "just punctuation", text: ".", mode: "sentence-end", expected: 1 },
    { name: "multi-line sentence", text: "Ciao mondo.\nProssima", mode: "sentence-end", expected: 11 },
    { name: "ellipsis terminator", text: "Aspetta… ora", mode: "sentence-end", expected: 8 },
    { name: "mixed punctuation", text: "Ciao?! dopo", mode: "sentence-end", expected: 6 },
    { name: "comma ignored by sentence mode", text: "Pausa, qui", mode: "sentence-end", expected: -1 },
    { name: "semicolon pause", text: "Pausa; qui", mode: "comma-pause", expected: 6 },
  ];

  for (const item of cases) {
    test(`#given ${item.name} #when detecting boundary #then returns expected index`, () => {
      // given
      const text = item.text;

      // when
      const boundary = detectClauseBoundary(text, item.mode);

      // then
      expect(boundary).toBe(item.expected);
    });
  }
});
