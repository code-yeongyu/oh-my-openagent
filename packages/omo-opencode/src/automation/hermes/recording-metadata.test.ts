import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { describe, it, expect, beforeEach, afterEach } from "bun:test";

import { 
  readRecordingMetadata, 
  writeRecordingMetadata, 
  renameRecording, 
  bumpRecordingUsage,
  RecordingMetadataError 
} from "./recording-metadata";
import { enhancedRecordingPaths } from "../../mcp/idm-browser/recording/recording-directory";

describe("Hermes Recording Metadata", () => {
  let originalHome: string | undefined;
  let tempHome: string;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tempHome = mkdtempSync(join(tmpdir(), "hermes-test-"));
    const root = join(tempHome, "Library", "Caches", "idm", "sessions");
    process.env.HOME = tempHome;
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  describe("readRecordingMetadata", () => {
    it("#given valid metadata #when read #then returns parsed object", async () => {
      const name = "test-recording";
      const paths = enhancedRecordingPaths(name);
      mkdirSync(paths.dir, { recursive: true });
      
      const metadata = {
        name,
        description: "Test description",
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        parameters: [{ name: "param1", type: "string", description: "p1" }],
        steps: 5,
        vision_checkpoint_count: 2
      };
      
      writeFileSync(paths.metadataJson, JSON.stringify(metadata));
      
      const result = await readRecordingMetadata(name);
      expect(result.name).toBe(name);
      expect(result.steps).toBe(5);
    });

    it("#given malformed JSON #when read #then throws RecordingMetadataError", async () => {
      const name = "malformed-recording";
      const paths = enhancedRecordingPaths(name);
      mkdirSync(paths.dir, { recursive: true });
      writeFileSync(paths.metadataJson, "{ invalid json }");
      
      await expect(readRecordingMetadata(name)).rejects.toThrow(RecordingMetadataError);
    });

    it("#given missing required field #when read #then throws with field name", async () => {
      const name = "missing-field-recording";
      const paths = enhancedRecordingPaths(name);
      mkdirSync(paths.dir, { recursive: true });
      
      const incompleteMetadata = {
        name,
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        parameters: [],
        steps: 0,
        vision_checkpoint_count: 0
      };
      
      writeFileSync(paths.metadataJson, JSON.stringify(incompleteMetadata));
      
      try {
        await readRecordingMetadata(name);
        expect(true).toBe(false);
      } catch (e) {
        expect(e).toBeInstanceOf(RecordingMetadataError);
        expect((e as Error).message).toContain("description");
      }
    });
  });

  describe("renameRecording", () => {
    it("#given existing recording #when rename #then directory and metadata.name updated", async () => {
      const oldName = "old-name";
      const newName = "new-name";
      const oldPaths = enhancedRecordingPaths(oldName);
      mkdirSync(oldPaths.dir, { recursive: true });
      
      const metadata = {
        name: oldName,
        description: "d",
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        parameters: [],
        steps: 0,
        vision_checkpoint_count: 0
      };
      writeFileSync(oldPaths.metadataJson, JSON.stringify(metadata));
      
      await renameRecording(oldName, newName);
      
      const newPaths = enhancedRecordingPaths(newName);
      expect(existsSync(oldPaths.dir)).toBe(false);
      expect(existsSync(newPaths.dir)).toBe(true);
      
      const updatedMetadata = await readRecordingMetadata(newName);
      expect(updatedMetadata.name).toBe(newName);
    });

    it("#given target name exists #when rename #then throws WITHOUT modifying source", async () => {
      const srcName = "src";
      const dstName = "dst";
      
      const srcPaths = enhancedRecordingPaths(srcName);
      const dstPaths = enhancedRecordingPaths(dstName);
      
      mkdirSync(srcPaths.dir, { recursive: true });
      mkdirSync(dstPaths.dir, { recursive: true });
      
      const metadata = {
        name: srcName,
        description: "d",
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        parameters: [],
        steps: 0,
        vision_checkpoint_count: 0
      };
      writeFileSync(srcPaths.metadataJson, JSON.stringify(metadata));
      writeFileSync(dstPaths.metadataJson, JSON.stringify({ ...metadata, name: dstName }));
      
      await expect(renameRecording(srcName, dstName)).rejects.toThrow(RecordingMetadataError);
      expect(existsSync(srcPaths.dir)).toBe(true);
      expect(existsSync(srcPaths.metadataJson)).toBe(true);
    });
  });

  describe("bumpRecordingUsage", () => {
    it("#given enhanced recording #when bumpRecordingUsage #then lastUsedAt updates", async () => {
      const name = "bump-test";
      const paths = enhancedRecordingPaths(name);
      mkdirSync(paths.dir, { recursive: true });
      
      const oldDate = "2020-01-01T00:00:00.000Z";
      const metadata = {
        name,
        description: "d",
        createdAt: oldDate,
        lastUsedAt: oldDate,
        parameters: [],
        steps: 0,
        vision_checkpoint_count: 0
      };
      writeFileSync(paths.metadataJson, JSON.stringify(metadata));
      
      await bumpRecordingUsage(name);
      
      const updated = await readRecordingMetadata(name);
      expect(updated.lastUsedAt).not.toBe(oldDate);
      expect(new Date(updated.lastUsedAt).getTime()).toBeGreaterThan(new Date(oldDate).getTime());
    });
  });
});
