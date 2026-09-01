import { describe, it, expect } from "bun:test";
import {
  parseMemoryFile,
  renderMemoryFile,
  FrontmatterError,
  type ParsedMemoryFile,
} from "./frontmatter";

describe("frontmatter", () => {
  describe("#given a well-formed memory file", () => {
    const content = [
      "---",
      "description: A note about the project",
      "---",
      "This is the body.",
    ].join("\n");

    it("#then parseMemoryFile extracts description and body", () => {
      const parsed = parseMemoryFile(content);

      expect(parsed.frontmatter.description).toBe(
        "A note about the project",
      );
      expect(parsed.frontmatter.read_only).toBeUndefined();
      expect(parsed.body).toBe("This is the body.");
    });

    it("#then renderMemoryFile roundtrips stably", () => {
      const parsed = parseMemoryFile(content);
      const rendered = renderMemoryFile(parsed.frontmatter, parsed.body);

      // parse -> render -> parse is stable; rendered uses LF and joins
      // header + body without extra trailing newline for non-empty body.
      expect(parsed).toEqual(parseMemoryFile(rendered));
      expect(rendered).toBe(content);
    });
  });

  describe("#given a memory file with read_only: true", () => {
    const content = [
      "---",
      "description: Locked note",
      "read_only: true",
      "---",
      "Body text.",
    ].join("\n");

    it("#then parseMemoryFile preserves read_only", () => {
      const parsed = parseMemoryFile(content);

      expect(parsed.frontmatter.read_only).toBe("true");
      expect(parsed.body).toBe("Body text.");
    });

    it("#then renderMemoryFile preserves read_only through edits", () => {
      const parsed = parseMemoryFile(content);
      const newBody = "Updated body content.";
      const rendered = renderMemoryFile(parsed.frontmatter, newBody);
      const reparsed = parseMemoryFile(rendered);

      expect(reparsed.frontmatter.read_only).toBe("true");
      expect(reparsed.frontmatter.description).toBe("Locked note");
      expect(reparsed.body).toBe(newBody);
    });
  });

  describe("#given frontmatter with a limit key (legacy)", () => {
    const content = [
      "---",
      "description: Has limit",
      "limit: 5000",
      "---",
      "Body.",
    ].join("\n");

    it("#then parseMemoryFile tolerates and ignores limit", () => {
      const parsed = parseMemoryFile(content);

      expect(parsed.frontmatter.description).toBe("Has limit");
      expect(parsed.frontmatter.read_only).toBeUndefined();
      expect(parsed.body).toBe("Body.");
    });
  });

  describe("#given CRLF line endings", () => {
    const content = [
      "---",
      "description: Windows file",
      "read_only: false",
      "---",
      "CRLF body.",
    ].join("\r\n");

    it("#then parseMemoryFile normalizes CRLF on read", () => {
      const parsed = parseMemoryFile(content);

      expect(parsed.frontmatter.description).toBe("Windows file");
      expect(parsed.frontmatter.read_only).toBe("false");
      expect(parsed.body).toBe("CRLF body.");
    });

    it("#then renderMemoryFile outputs LF only", () => {
      const parsed = parseMemoryFile(content);
      const rendered = renderMemoryFile(parsed.frontmatter, parsed.body);

      expect(rendered).not.toContain("\r\n");
      expect(rendered).toContain("\n");
    });
  });

  describe("#given a description with embedded newlines", () => {
    const content = [
      "---",
      "description: A note about the project",
      "read_only: true",
      "---",
      "Body.",
    ].join("\n");

    it("#then renderMemoryFile collapses newlines in description to spaces", () => {
      const multilineDescription = "Line one\nLine two\r\nLine three";
      const rendered = renderMemoryFile(
        { description: multilineDescription, read_only: "true" },
        "Body.",
      );

      const reparsed = parseMemoryFile(rendered);
      expect(reparsed.frontmatter.description).toBe(
        "Line one Line two Line three",
      );
    });
  });

  describe("#given an empty body", () => {
    const content = ["---", "description: Just frontmatter", "---", ""].join(
      "\n",
    );

    it("#then parseMemoryFile yields empty body", () => {
      const parsed = parseMemoryFile(content);

      expect(parsed.body).toBe("");
    });

    it("#then renderMemoryFile with empty body produces header with trailing newline", () => {
      const rendered = renderMemoryFile(
        { description: "Just frontmatter" },
        "",
      );

      expect(rendered).toBe(
        "---\ndescription: Just frontmatter\n---\n",
      );
    });
  });

  describe("#given frontmatter without closing delimiter", () => {
    const content = "---\ndescription: Missing close\nbody text";

    it("#then parseMemoryFile throws FrontmatterError", () => {
      expect(() => parseMemoryFile(content)).toThrow(FrontmatterError);
    });
  });

  describe("#given a file with no frontmatter at all", () => {
    const content = "Just some plain text.\nNo frontmatter here.";

    it("#then parseMemoryFile throws FrontmatterError", () => {
      expect(() => parseMemoryFile(content)).toThrow(FrontmatterError);
    });
  });

  describe("#given frontmatter with missing description", () => {
    const content = "---\nread_only: true\n---\nBody.";

    it("#then parseMemoryFile throws FrontmatterError", () => {
      expect(() => parseMemoryFile(content)).toThrow(FrontmatterError);
    });
  });

  describe("#given frontmatter with empty description value", () => {
    const content = "---\ndescription:   \n---\nBody.";

    it("#then parseMemoryFile throws FrontmatterError", () => {
      expect(() => parseMemoryFile(content)).toThrow(FrontmatterError);
    });
  });

  describe("#given renderMemoryFile with empty description", () => {
    it("#then throws FrontmatterError", () => {
      expect(() =>
        renderMemoryFile({ description: "   " }, "body"),
      ).toThrow(FrontmatterError);
    });
  });

  describe("#given renderMemoryFile with whitespace-only description", () => {
    it("#then throws FrontmatterError", () => {
      expect(() =>
        renderMemoryFile({ description: "\n\t  \n" }, "body"),
      ).toThrow(FrontmatterError);
    });
  });

  describe("roundtrip stability", () => {
    it("#then parse -> render -> parse is stable across varied inputs", () => {
      const cases: ParsedMemoryFile[] = [
        {
          frontmatter: { description: "Simple" },
          body: "Body one.",
        },
        {
          frontmatter: { description: "With read_only", read_only: "true" },
          body: "Body two.\nSecond line.",
        },
        {
          frontmatter: { description: "Multi-word description here" },
          body: "",
        },
        {
          frontmatter: {
            description: "Special chars: !@#$%^&*()",
            read_only: "false",
          },
          body: "Body with special content.\n\nNew paragraph.",
        },
      ];

      for (const original of cases) {
        const rendered = renderMemoryFile(original.frontmatter, original.body);
        const reparsed = parseMemoryFile(rendered);

        expect(reparsed).toEqual(original);
      }
    });
  });

  describe("#given description with surrounding whitespace", () => {
    it("#then renderMemoryFile trims description", () => {
      const rendered = renderMemoryFile(
        { description: "  spaced  " },
        "body",
      );
      const reparsed = parseMemoryFile(rendered);

      expect(reparsed.frontmatter.description).toBe("spaced");
    });
  });

  describe("#given frontmatter with extra whitespace around keys", () => {
    const content = [
      "---",
      "  description  :   Padded value  ",
      "read_only:  true  ",
      "---",
      "Body.",
    ].join("\n");

    it("#then parseMemoryFile trims keys and values", () => {
      const parsed = parseMemoryFile(content);

      expect(parsed.frontmatter.description).toBe("Padded value");
      expect(parsed.frontmatter.read_only).toBe("true");
    });
  });
});
