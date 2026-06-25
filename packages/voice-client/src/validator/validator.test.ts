import { describe, expect, test } from "bun:test";
import type { ValidationResult } from "./types";

async function validateText(input: string): Promise<ValidationResult> {
  const { validate } = await import("./validator");
  return validate(input);
}

async function expectForbidden(input: string, ruleId: string): Promise<ValidationResult> {
  const result = await validateText(input);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.violations.some((violation) => violation.ruleId === ruleId)).toBe(true);
  }
  return result;
}

async function expectAllowed(input: string): Promise<void> {
  const result = await validateText(input);
  expect(result).toEqual({ ok: true });
}

describe("#given verbatim voice validator grammar", () => {
  describe("#when forbidden Markdown and machine-readable syntax appears", () => {
    test("#then code-fence-triple-backtick rejects triple backtick code fence", async () => {
      // given
      const input = "```ts\nconsole.log('ciao');\n```";

      // when / then
      await expectForbidden(input, "code-fence-triple-backtick");
    });

    test("#then code-fence-triple-backtick rejects inline triple backticks", async () => {
      // given
      const input = "non dire ``` mai ad alta voce";

      // when / then
      await expectForbidden(input, "code-fence-triple-backtick");
    });

    test("#then code-span-single-backtick rejects single backtick code span", async () => {
      // given
      const input = "ho usato `console.log` durante la prova";

      // when / then
      await expectForbidden(input, "code-span-single-backtick");
    });

    test("#then markdown-heading-h1 rejects # Heading at line start", async () => {
      // given
      const input = "# Heading";

      // when / then
      await expectForbidden(input, "markdown-heading-h1");
    });

    test("#then markdown-heading-h2 rejects ## Sub at line start", async () => {
      // given
      const input = "## Sub";

      // when / then
      await expectForbidden(input, "markdown-heading-h2");
    });

    test("#then markdown-heading-h3 rejects ### h3 at line start", async () => {
      // given
      const input = "### h3";

      // when / then
      await expectForbidden(input, "markdown-heading-h3");
    });

    test("#then markdown-heading-h4 rejects #### h4 at line start", async () => {
      // given
      const input = "#### h4";

      // when / then
      await expectForbidden(input, "markdown-heading-h4");
    });

    test("#then markdown-list-dash rejects dash bullet at line start", async () => {
      // given
      const input = "- bullet";

      // when / then
      await expectForbidden(input, "markdown-list-dash");
    });

    test("#then markdown-list-asterisk rejects asterisk bullet at line start", async () => {
      // given
      const input = "* bullet";

      // when / then
      await expectForbidden(input, "markdown-list-asterisk");
    });

    test("#then markdown-list-plus rejects plus bullet at line start", async () => {
      // given
      const input = "+ bullet";

      // when / then
      await expectForbidden(input, "markdown-list-plus");
    });

    test("#then markdown-list-numbered rejects numbered list at line start", async () => {
      // given
      const input = "1. numbered";

      // when / then
      await expectForbidden(input, "markdown-list-numbered");
    });

    test("#then markdown-table rejects pipe table with separator row", async () => {
      // given
      const input = "| col1 | col2 |\n|---|---|";

      // when / then
      await expectForbidden(input, "markdown-table");
    });

    test("#then markdown-link rejects bracket-parenthesis link", async () => {
      // given
      const input = "leggi [link text](https://example.com) adesso";

      // when / then
      await expectForbidden(input, "markdown-link");
    });

    test("#then markdown-image rejects image syntax", async () => {
      // given
      const input = "guarda ![alt](image.png)";

      // when / then
      await expectForbidden(input, "markdown-image");
    });

    test("#then emoji-unicode rejects emoji glyph", async () => {
      // given
      const input = "va bene 😀";

      // when / then
      await expectForbidden(input, "emoji-unicode");
    });

    test("#then control-character rejects bell control character", async () => {
      // given
      const input = "prima\x07dopo";

      // when / then
      await expectForbidden(input, "control-character");
    });

    test("#then markdown-list-dash rejects caveman-style bullets per line", async () => {
      // given
      const input = "- thing\n- thing\n- thing";

      // when
      const result = await expectForbidden(input, "markdown-list-dash");

      // then
      if (!result.ok) {
        expect(result.violations.filter((violation) => violation.ruleId === "markdown-list-dash")).toHaveLength(3);
      }
    });

    test("#then code-span-single-backtick reports offset for mixed prose and inline code", async () => {
      // given
      const input = "ho usato `console.log`";

      // when
      const result = await expectForbidden(input, "code-span-single-backtick");

      // then
      if (!result.ok) {
        expect(result.violations[0]?.offset).toBe(input.indexOf("`"));
      }
    });

    test("#then json-leak-heuristic rejects JSON object leak outside dialogue quotes", async () => {
      // given
      const input = '{"result": 42, "items": [1, 2, 3]}';

      // when / then
      await expectForbidden(input, "json-leak-heuristic");
    });

    test("#then code-block-indented-4space rejects two-line indented code block", async () => {
      // given
      const input = "    const uno = 1;\n    const due = 2;";

      // when / then
      await expectForbidden(input, "code-block-indented-4space");
    });
  });

  describe("#when Italian prose exceptions appear", () => {
    test("#then italian-apostrophe-word allows l'altro", async () => {
      // given
      const input = "l'altro giorno era diverso";

      // when / then
      await expectAllowed(input);
    });

    test("#then italian-apostrophe-word allows all'ora", async () => {
      // given
      const input = "arrivo all'ora stabilita";

      // when / then
      await expectAllowed(input);
    });

    test("#then italian-apostrophe-word allows sull'uscio and dell'acqua", async () => {
      // given
      const input = "rimani sull'uscio con dell'acqua";

      // when / then
      await expectAllowed(input);
    });

    test("#then italian-virgolette allows guillemet dialogue", async () => {
      // given
      const input = "ha detto «virgolette italiane» lentamente";

      // when / then
      await expectAllowed(input);
    });

    test("#then ellipsis-prose allows single ellipsis glyph", async () => {
      // given
      const input = "vediamo… poi decidiamo";

      // when / then
      await expectAllowed(input);
    });

    test("#then ellipsis-prose allows three dots in prose", async () => {
      // given
      const input = "aspetta... ora riprovo";

      // when / then
      await expectAllowed(input);
    });

    test("#then dialogue-dash-spaced allows em-dash dialogue", async () => {
      // given
      const input = "— ha detto lui — è vero";

      // when / then
      await expectAllowed(input);
    });

    test("#then standalone-asterisk-mid-sentence allows literal multiplication asterisk", async () => {
      // given
      const input = "5 * 4 = 20";

      // when / then
      await expectAllowed(input);
    });

    test("#then single-pipe-mid-sentence allows one prose pipe", async () => {
      // given
      const input = "ho detto | poi ho aggiunto";

      // when / then
      await expectAllowed(input);
    });

    test("#then hash-not-line-start allows numeric hash marker #1 priority", async () => {
      // given
      // Decision: # followed by a number is spoken as an ordinal marker, not a Markdown heading.
      const input = "#1 priority";

      // when / then
      await expectAllowed(input);
    });

    test("#then valid-clean-prose allows clean multi-paragraph prose", async () => {
      // given
      const input = "Primo paragrafo con tono naturale.\n\nSecondo paragrafo senza sintassi Markdown.";

      // when / then
      await expectAllowed(input);
    });

    test("#then valid-caveman-collision allows pure prose after caveman context", async () => {
      // given
      const input = "Risposta vocale naturale, senza elenchi, senza simboli speciali e senza formattazione.";

      // when / then
      await expectAllowed(input);
    });

    test("#then quoted-dialogue-braces allows braces inside paired dialogue quotes", async () => {
      // given
      // Decision: braces inside paired dialogue quotes are literal spoken content, not JSON leakage.
      const input = 'ha detto: "vai a {casa}"';

      // when / then
      await expectAllowed(input);
    });

    test("#then quoted-dialogue-braces allows braces inside Italian virgolette", async () => {
      // given
      const input = "ha detto: «vai a {casa}»";

      // when / then
      await expectAllowed(input);
    });
  });
});
