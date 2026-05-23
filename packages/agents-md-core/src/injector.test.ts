import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import { processFilePathForAgentsInjection } from "./injector";

describe("processFilePathForAgentsInjection", () => {
  const sessionCaches = new Map<string, Set<string>>();
  const storageBackfill = new Map<string, Set<string>>();
  const storage = {
    loadInjectedPaths: (sessionID: string): Set<string> =>
      storageBackfill.get(sessionID) ?? new Set<string>(),
    saveInjectedPaths: (sessionID: string, paths: Set<string>): void => {
      storageBackfill.set(sessionID, paths);
    },
  };

  const truncator = {
    truncate: async (_sessionID: string, content: string) => ({
      result: content,
      truncated: false,
    }),
  };

  let rootDirectory = "";

  afterEach(() => {
    if (rootDirectory) {
      rmSync(rootDirectory, { recursive: true, force: true });
    }
    rootDirectory = "";
    sessionCaches.clear();
    storageBackfill.clear();
  });

  it("injects AGENTS.md chain in root-skipping order with unchanged context format", async () => {
    // given
    rootDirectory = join(tmpdir(), `agents-md-core-injector-${randomUUID()}`);
    const srcDirectory = join(rootDirectory, "src");
    const nestedDirectory = join(srcDirectory, "components");
    mkdirSync(nestedDirectory, { recursive: true });

    const rootAgents = "# root";
    const srcAgents = "# src";
    const nestedAgents = "# nested";

    writeFileSync(join(rootDirectory, "AGENTS.md"), rootAgents);
    writeFileSync(join(srcDirectory, "AGENTS.md"), srcAgents);
    writeFileSync(join(nestedDirectory, "AGENTS.md"), nestedAgents);
    writeFileSync(join(nestedDirectory, "button.ts"), "export const button = true;\n");

    const output = {
      title: "read result",
      output: "base output",
      metadata: {},
    };

    const srcAgentsPath = join(srcDirectory, "AGENTS.md");
    const nestedAgentsPath = join(nestedDirectory, "AGENTS.md");
    const expectedOutput =
      "base output" +
      `\n\n[Directory Context: ${srcAgentsPath}]\n${srcAgents}` +
      `\n\n[Directory Context: ${nestedAgentsPath}]\n${nestedAgents}`;

    // when
    await processFilePathForAgentsInjection({
      rootDirectory,
      truncator,
      sessionCaches,
      storage,
      filePath: join(nestedDirectory, "button.ts"),
      sessionID: "session-regression",
      output,
    });

    // then
    expect(output.output).toBe(expectedOutput);
    expect(output.output).not.toContain(rootAgents);
  });
});
