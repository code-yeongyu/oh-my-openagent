import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { SemanticMemory } from "./index";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";

const TEST_DIR = ".sisyphus/memory-test";

describe("SemanticMemory", () => {
  let memory: SemanticMemory;

  beforeEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
    memory = new SemanticMemory({ baseDir: TEST_DIR });
  });

  afterEach(async () => {
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  test("should return null for non-existent key", async () => {
    const value = await memory.get("non-existent");
    expect(value).toBeNull();
  });

  test("should set and get a value", async () => {
    await memory.set("test-key", { foo: "bar" });
    const value = await memory.get("test-key");
    expect(value).toEqual({ foo: "bar" });
  });

  test("should delete a value", async () => {
    await memory.set("test-key", { foo: "bar" });
    await memory.delete("test-key");
    const value = await memory.get("test-key");
    expect(value).toBeNull();
  });

  test("should support namespaces", async () => {
    const mem1 = new SemanticMemory({ baseDir: TEST_DIR, namespace: "ns1" });
    const mem2 = new SemanticMemory({ baseDir: TEST_DIR, namespace: "ns2" });

    await mem1.set("key", "value1");
    await mem2.set("key", "value2");

    expect(await mem1.get("key")).toBe("value1");
    expect(await mem2.get("key")).toBe("value2");
  });

  test("should handle TTL", async () => {
    await memory.set("ttl-key", "value", { ttl: 10 });
    
    expect(await memory.get("ttl-key")).toBe("value");

    await new Promise(resolve => setTimeout(resolve, 20));

    expect(await memory.get("ttl-key")).toBeNull();
  });

  test("should search keys by pattern", async () => {
    await memory.set("user:1:name", "Alice");
    await memory.set("user:1:email", "alice@example.com");
    await memory.set("user:2:name", "Bob");
    await memory.set("config:global", "dark-mode");

    const results = await memory.search("user:1:*");
    expect(results).toHaveLength(2);
    expect(results).toContainEqual({ key: "user:1:name", value: "Alice" });
    expect(results).toContainEqual({ key: "user:1:email", value: "alice@example.com" });
  });
});
