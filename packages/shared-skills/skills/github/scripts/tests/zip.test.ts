import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { safeJoin, unzip } from "../src/zip.ts";
import { makeZip } from "./zip-fixture.ts";

const kindOf = (fn: () => unknown) => {
  try {
    fn();
    return "returned";
  } catch (error) {
    return String(Reflect.get(Object(error), "kind"));
  }
};
const text = (data: Uint8Array) => new TextDecoder().decode(data);

describe("zip reader", () => {
  test("reads stored and deflated entries and skips directories", () => {
    const entries = unzip(
      makeZip([
        { name: "dir/", data: "" },
        { name: "a.txt", data: "plain" },
        { name: "dir/b.log", data: "x".repeat(500), deflate: true },
      ]),
    );
    expect(entries.map((e) => [e.path, text(e.data)])).toEqual([
      ["a.txt", "plain"],
      ["dir/b.log", "x".repeat(500)],
    ]);
  });

  test("a corrupted payload fails its checksum", () => {
    const zip = makeZip([{ name: "a.txt", data: "plain" }]);
    zip[30 + "a.txt".length] = "P".charCodeAt(0);
    expect(kindOf(() => unzip(zip))).toBe("invalid_response");
  });

  test("bytes that are not a zip, or a truncated one, are refused", () => {
    expect(kindOf(() => unzip(new TextEncoder().encode("not a zip")))).toBe(
      "invalid_response",
    );
    const zip = makeZip([{ name: "a.txt", data: "plain" }]);
    expect(kindOf(() => unzip(zip.subarray(10)))).toBe("invalid_response");
  });

  test("safeJoin keeps paths inside the directory and refuses escapes", () => {
    expect(safeJoin("/tmp/out", "a/b.txt")).toBe(
      join(resolve("/tmp/out"), "a/b.txt"),
    );
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "a\\..\\x", "."])
      expect(kindOf(() => safeJoin("/tmp/out", bad))).toBe("invalid_response");
  });
});
