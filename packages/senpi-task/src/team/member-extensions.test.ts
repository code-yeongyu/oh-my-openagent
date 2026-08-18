import { describe, expect, test } from "bun:test"

import { assembleMemberExtensions } from "./member-extensions"

describe("assembleMemberExtensions", () => {
  test("#given duplicated and ordered inherited extensions #when assembled #then member stays first and inherited order is stable", () => {
    expect(assembleMemberExtensions("/member.js", [
      "/provider-a.js",
      "/member.js",
      "/provider-b.js",
      "/provider-a.js",
    ])).toEqual([
      "/member.js",
      "/provider-a.js",
      "/provider-b.js",
    ])
  })
})
