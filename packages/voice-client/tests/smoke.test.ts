import { describe, expect, test } from "bun:test";
import { VERSION } from "../src/index.ts";

describe("voice-client VERSION", () => {
  test("#given scaffold #when VERSION is imported #then it equals 0.0.1", () => {
    // given
    const expected = "0.0.1";

    // when
    const actual = VERSION;

    // then
    expect(actual).toBe(expected);
  });
});
