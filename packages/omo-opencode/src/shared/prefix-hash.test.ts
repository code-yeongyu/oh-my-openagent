import { describe, expect, it } from "bun:test"
import {
  PREFIX_HASH_ALGORITHM,
  PREFIX_HASH_HEX_LENGTH,
  prefixHash,
} from "./prefix-hash"

describe("prefixHash", () => {
  it("is deterministic for identical canonical bytes", () => {
    // given
    const bytes = '{"a":1,"b":[3,1,2]}'

    // when
    const first = prefixHash(bytes)
    const second = prefixHash(bytes)

    // then
    expect(first).toBe(second)
  })

  it("flips when one byte changes", () => {
    // given
    const before = '{"a":1}'
    const after = '{"a":2}'

    // when
    const hashBefore = prefixHash(before)
    const hashAfter = prefixHash(after)

    // then
    expect(hashBefore).not.toBe(hashAfter)
  })

  it("pins the algorithm and output length for diagnostics stability", () => {
    // given pinned diagnostics contract: sha256 truncated to 16 hex chars
    // when reading the exported constants
    // then
    expect(PREFIX_HASH_ALGORITHM).toBe("sha256")
    expect(PREFIX_HASH_HEX_LENGTH).toBe(16)
    expect(prefixHash('{"a":1}')).toMatch(/^[0-9a-f]{16}$/)
  })
})
