import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MemoryPathError,
  validateMemoryPath,
  validateRepositoryPath,
} from "./paths";

const temporaryDirectories: string[] = [];

function createFixture(): { base: string; root: string } {
  const base = mkdtempSync(join(tmpdir(), "memory-paths-"));
  const root = join(base, "memory");
  mkdirSync(root);
  temporaryDirectories.push(base);
  return { base, root };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("validateMemoryPath", () => {
  describe("#given valid tool labels #when normalized #then they resolve to confined markdown files", () => {
    const cases = [
      ["system/notes", "system/notes.md"],
      ["system/notes.md", "system/notes.md"],
      ["memory/system/notes", "system/notes.md"],
      ["memory/reference/nested/topic.md", "reference/nested/topic.md"],
      ["system//nested///notes", "system/nested/notes.md"],
      ["system\\nested\\notes.md", "system/nested/notes.md"],
      ["  system/notes.md  ", "system/notes.md"],
    ] as const;

    for (const [input, expected] of cases) {
      it(`#given ${JSON.stringify(input)} #when validated #then returns ${expected}`, () => {
        const { root } = createFixture();

        expect(validateMemoryPath(root, input)).toBe(join(root, expected));
      });
    }

    it("#given an absolute path inside root #when validated #then it is accepted", () => {
      const { root } = createFixture();
      const input = join(root, "system", "absolute.md");

      expect(validateMemoryPath(root, input)).toBe(input);
    });
  });

  describe("#given hostile labels #when validated #then they are rejected", () => {
    const cases = [
      ["", "non-empty"],
      ["   ", "non-empty"],
      ["memory/", "empty"],
      ["../etc", "traversal"],
      ["a/../../etc", "traversal"],
      ["a/./notes", "traversal"],
      ["system/../notes", "traversal"],
      ["system/nu\0ll", "null"],
      ["~/x", "home-relative"],
      ["$HOME/x", "home-relative"],
      ["notes.txt", "markdown"],
      ["notes.MD", "markdown"],
      ["notes.Md", "markdown"],
      [".git/config", ".git"],
      [".GIT/config.md", ".git"],
      ["system/.Git/config.md", ".git"],
      ["memory/.gIt/config", ".git"],
    ] as const;

    for (const [input, message] of cases) {
      it(`#given ${JSON.stringify(input)} #when validated #then rejects with ${message}`, () => {
        const { root } = createFixture();

        expect(() => validateMemoryPath(root, input)).toThrow(message);
      });
    }

    it("#given an absolute path outside root #when validated #then it is rejected", () => {
      const { base, root } = createFixture();
      const outside = join(base, "outside.md");

      expect(() => validateMemoryPath(root, outside)).toThrow("only be used");
    });

    it("#given the root itself as an absolute path #when validated #then it is rejected", () => {
      const { root } = createFixture();

      expect(() => validateMemoryPath(root, root)).toThrow("only be used");
    });

    it("#given a Windows absolute path outside root #when validated #then it is rejected", () => {
      const { root } = createFixture();

      expect(() => validateMemoryPath(root, "C:\\Windows\\system.ini")).toThrow(
        "only be used",
      );
    });
  });

  describe("#given filesystem indirection #when validated #then real ancestors remain confined", () => {
    it("#given a symlink directory escaping root #when a child is validated #then it is rejected", () => {
      const { base, root } = createFixture();
      const outside = join(base, "outside");
      mkdirSync(outside);
      symlinkSync(outside, join(root, "escape"),
        process.platform === "win32" ? "junction" : "dir");

      expect(() => validateMemoryPath(root, "escape/secret.md")).toThrow(
        "symlink",
      );
    });

    it("#given an existing symlink file escaping root #when validated #then it is rejected", () => {
      const { base, root } = createFixture();
      const outside = join(base, "outside.md");
      writeFileSync(outside, "secret");
      symlinkSync(outside, join(root, "linked.md"), "file");

      expect(() => validateMemoryPath(root, "linked.md")).toThrow("symlink");
    });

    it("#given a real existing parent inside root #when a missing child is validated #then it is accepted", () => {
      const { root } = createFixture();
      mkdirSync(join(root, "system"));

      expect(validateMemoryPath(root, "system/new.md")).toBe(
        join(root, "system", "new.md"),
      );
    });

    it("#given a symlink directory staying inside root #when a child is validated #then it is accepted", () => {
      const { root } = createFixture();
      const system = join(root, "system");
      mkdirSync(system);
      symlinkSync(system, join(root, "alias"),
        process.platform === "win32" ? "junction" : "dir");

      expect(validateMemoryPath(root, "alias/notes.md")).toBe(
        join(root, "alias", "notes.md"),
      );
    });
  });

  describe("#given a non-tool repository caller #when validated #then non-markdown paths are allowed but confined", () => {
    it("#given a directory label #when validated through repository API #then no extension is added", () => {
      const { root } = createFixture();

      expect(validateRepositoryPath(root, "reference/archive")).toBe(
        join(root, "reference", "archive"),
      );
    });

    it("#given a non-markdown file #when validated through repository API #then it is accepted", () => {
      const { root } = createFixture();

      expect(validateMemoryPath(root, "assets/tree.txt", { toolPath: false })).toBe(
        join(root, "assets", "tree.txt"),
      );
    });

    it("#given .git with repository API #when validated #then it remains rejected", () => {
      const { root } = createFixture();

      expect(() => validateRepositoryPath(root, ".git/config")).toThrow(".git");
    });

    it("#given traversal with repository API #when validated #then it remains rejected", () => {
      const { root } = createFixture();

      expect(() => validateRepositoryPath(root, "a/../../etc")).toThrow(
        MemoryPathError,
      );
    });
  });
});
