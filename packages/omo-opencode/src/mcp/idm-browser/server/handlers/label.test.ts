import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { createBrowserPool } from "../../pool/browser-pool";
import { handleNavigate, type NavigateParams } from "./navigate";
import { handleEndSession, type EndSessionParams } from "./end-session";

describe("T8: MCP server label parameter", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tempDir = mkdtempSync(join(tmpdir(), "idm-t8-test-"));
    process.env.HOME = tempDir;
    // Create the sessions directory structure
    mkdirSync(join(tempDir, "Library/Caches/idm/sessions"), { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(tempDir, { recursive: true, force: true });
  });

  // TODO(camoufox-on-ci): both tests instantiate a real browser pool, which requires camoufox installed on the runner. Install camoufox via `bun x camoufox fetch` in CI, or guard with skipIf(!isCamoufoxInstalled()).
  describe.skip("browser_navigate with label", () => {
    test("#given label #when handleNavigate #then creates enhanced recording dir with metadata", async () => {
      const pool = createBrowserPool({ maxConcurrent: 1 });
      const label = "test-label";
      
      const params: NavigateParams = {
        url: "https://example.com",
        label
      };

      const result = await handleNavigate(pool, params);
      const sessionId = JSON.parse(result.content[0].text!).sessionId;

      const recordingDir = join(tempDir, "Library/Caches/idm/sessions", label);
      expect(existsSync(recordingDir)).toBe(true);
      expect(existsSync(join(recordingDir, "metadata.json"))).toBe(true);
      expect(existsSync(join(recordingDir, "session.jsonl"))).toBe(true);
      
      const metadata = JSON.parse(readFileSync(join(recordingDir, "metadata.json"), "utf-8"));
      expect(metadata.name).toBe(label);
      
      await pool.shutdown();
    });
  });

  // TODO(camoufox-on-ci): same as above — pool requires camoufox installed.
  describe.skip("browser_end_session with label", () => {
    test("#given existing session #when handleEndSession with label #then renames recording dir", async () => {
      const pool = createBrowserPool({ maxConcurrent: 1 });
      
      const navParams: NavigateParams = { url: "https://example.com", label: "initial-label" };
      const navResult = await handleNavigate(pool, navParams);
      const sessionId = JSON.parse(navResult.content[0].text!).sessionId;
      
      const oldDir = join(tempDir, "Library/Caches/idm/sessions", "initial-label");
      expect(existsSync(oldDir)).toBe(true);

      const endParams: EndSessionParams = { sessionId, label: "final-label" };
      await handleEndSession(pool, endParams);

      const newDir = join(tempDir, "Library/Caches/idm/sessions", "final-label");
      expect(existsSync(newDir)).toBe(true);
      expect(existsSync(oldDir)).toBe(false);
      
      const metadata = JSON.parse(readFileSync(join(newDir, "metadata.json"), "utf-8"));
      expect(metadata.name).toBe("final-label");

      await pool.shutdown();
    });
  });
});
