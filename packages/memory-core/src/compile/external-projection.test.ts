import { describe, expect, it } from "bun:test"
import { renderExternalProjection, renderExternalProjectionStats } from "./index"

const at = (entries: Record<string, number>): ReadonlyMap<string, number> => new Map(Object.entries(entries))
const bytes = (text: string): number => Buffer.byteLength(text)

describe("renderExternalProjection limits", () => {
  it("#given a per-directory cap #when rendered #then the newest names show and the rest are counted with a pointer", () => {
    // given
    const paths = ["dir/c1.md", "dir/c2.md", "dir/c3.md"]
    const times = at({ "dir/c1.md": 1, "dir/c2.md": 2, "dir/c3.md": 3 })

    // when
    const text = renderExternalProjection(paths, { times, limits: { maxEntriesPerDirectory: 2, maxBytes: 0 } })

    // then
    expect(text.split("\n")).toContain("dir/: c3.md, c2.md (+1 more; read $MEMORY_DIR/dir/ to list)")
  })

  it("#given both limits disabled #when rendered #then the bytes equal the unbounded renderer's", () => {
    // given
    const paths = [
      "ARCHIVE.md", "reference/zeta.md", "reference/Alpha.md", "reference/project/b.md", "reference/project/a.md",
      "people/한글/card.md", "notes/n.md", "reference/AKIAABCDEFGHIJKLMNOP.md",
    ]
    const unbounded = "<external_projection>\n$MEMORY_DIR/: ARCHIVE.md\nnotes/: n.md\npeople/한글/: card.md\nreference/: ***.md, Alpha.md, zeta.md\nreference/project/: a.md, b.md\n</external_projection>"

    // when
    const disabled = renderExternalProjection(paths, {
      times: at({ "reference/zeta.md": 9, "notes/n.md": 1 }),
      limits: { maxEntriesPerDirectory: 0, maxBytes: 0 },
    })

    // then
    expect(disabled).toBe(unbounded)
    expect(renderExternalProjection(paths)).toBe(unbounded)
  })

  it("#given a byte budget below the full render #when rendered #then the largest directory shrinks first and every directory line stays", () => {
    // given
    const big = Array.from({ length: 8 }, (_, index) => `big/entry-${index}.md`)
    const paths = [...big, "small/s1.md", "small/s2.md"]
    const times = at(Object.fromEntries(paths.map((path, index) => [path, index])))
    const full = renderExternalProjection(paths, { times, limits: { maxEntriesPerDirectory: 0, maxBytes: 0 } })
    const limits = { maxEntriesPerDirectory: 0, maxBytes: bytes(full) - 40 }

    // when
    const first = renderExternalProjection(paths, { times, limits })
    const second = renderExternalProjection(paths, { times, limits })

    // then
    expect(bytes(first)).toBeLessThanOrEqual(limits.maxBytes)
    expect(first).toBe(second)
    expect(first.split("\n")).toContain("small/: s2.md, s1.md")
    expect(first).toMatch(/^big\/: (?:entry-\d\.md, )*entry-\d\.md \(\+\d+ more; read \$MEMORY_DIR\/big\/ to list\)$/m)
  })

  it("#given a budget too small for the full render #when fitted #then only the wider directory gives up names", () => {
    // given
    const wide = Array.from({ length: 30 }, (_, index) => `zz/entry-${String(index).padStart(2, "0")}.md`)
    const paths = ["aa/x1.md", "aa/x2.md", ...wide]
    const times = at(Object.fromEntries(paths.map((path, index) => [path, index])))
    const full = renderExternalProjection(paths, { times, limits: { maxEntriesPerDirectory: 0, maxBytes: 0 } })

    // when
    const text = renderExternalProjection(paths, { times, limits: { maxEntriesPerDirectory: 0, maxBytes: bytes(full) - 60 } })

    // then
    expect(bytes(text)).toBeLessThanOrEqual(bytes(full) - 60)
    expect(text.split("\n")).toContain("aa/: x2.md, x1.md")
    expect(text).toMatch(/^zz\/: entry-29\.md, .* \(\+\d+ more; read \$MEMORY_DIR\/zz\/ to list\)$/m)
  })

  it("#given a budget one byte below the next larger listing #when fitted #then shrinking stops at the first listing that fits, line breaks counted", () => {
    // given
    const wide = Array.from({ length: 30 }, (_, index) => `zz/entry-${String(index).padStart(2, "0")}.md`)
    const paths = ["aa/x1.md", "aa/x2.md", ...wide]
    const times = at(Object.fromEntries(paths.map((path, index) => [path, index])))
    const ten = renderExternalProjection(paths, { times, limits: { maxEntriesPerDirectory: 10, maxBytes: 0 } })
    const eleven = renderExternalProjection(paths, { times, limits: { maxEntriesPerDirectory: 11, maxBytes: 0 } })

    // when
    const limits = { maxEntriesPerDirectory: 0, maxBytes: bytes(eleven) - 1 }
    const text = renderExternalProjection(paths, { times, limits })

    // then
    expect(text).toBe(ten)
    expect(renderExternalProjectionStats(paths, { times, limits }).overflow).toBe(false)
  })

  it("#given short names whose omitted-names markers outweigh them #when the budget is just under the full listing #then the render is never larger than the uncapped one", () => {
    // given
    const paths = Array.from({ length: 12 }, (_, index) => [`d${index}/a.md`, `d${index}/b.md`]).flat()
    const full = renderExternalProjection(paths, { times: at({}), limits: { maxEntriesPerDirectory: 0, maxBytes: 0 } })

    // when
    const limits = { maxEntriesPerDirectory: 0, maxBytes: bytes(full) - 1 }
    const text = renderExternalProjection(paths, { times: at({}), limits })

    // then
    expect(bytes(text)).toBeLessThanOrEqual(bytes(full))
    expect(renderExternalProjectionStats(paths, { times: at({}), limits })).toMatchObject({ overflow: true, bytes: bytes(text) })
  })

  it("#given a listing that fits only with one directory full and another emptied #when widest-first shrinking misses it #then that listing is found and no overflow is reported", () => {
    // given
    const long = "a-name-long-enough-to-outweigh-its-omitted-names-marker"
    const paths = [
      ...["a", "b", "c", "d", "e", "f"].map((name) => `A/${name}.md`),
      `B/${long}-1.md`, `B/${long}-2.md`,
    ]
    const smallest = [
      "<external_projection>",
      "$MEMORY_DIR/",
      "A/: a.md, b.md, c.md, d.md, e.md, f.md",
      "B/: (+2 more; read $MEMORY_DIR/B/ to list)",
      "</external_projection>",
    ].join("\n")

    // when
    const limits = { maxEntriesPerDirectory: 0, maxBytes: bytes(smallest) }
    const text = renderExternalProjection(paths, { times: at({}), limits })

    // then
    expect(text).toBe(smallest)
    expect(renderExternalProjectionStats(paths, { times: at({}), limits }).overflow).toBe(false)
  })

  it("#given a budget equal to the exact size of the full render #when fitted #then nothing is omitted", () => {
    // given
    const paths = ["a/1.md", "a/2.md", "b/1.md", "b/2.md", "c/1.md"]
    const times = at(Object.fromEntries(paths.map((path, index) => [path, index])))
    const full = renderExternalProjection(paths, { times, limits: { maxEntriesPerDirectory: 100, maxBytes: 0 } })

    // when
    const fitted = renderExternalProjection(paths, { times, limits: { maxEntriesPerDirectory: 100, maxBytes: bytes(full) } })

    // then
    expect(fitted).toBe(full)
  })

  it("#given a directory whose name is masked #when names are omitted #then the pointer names the nearest readable parent", () => {
    // given
    const paths = ["reference/AKIAABCDEFGHIJKLMNOP/a.md", "reference/AKIAABCDEFGHIJKLMNOP/b.md"]

    // when
    const text = renderExternalProjection(paths, { times: at({}), limits: { maxEntriesPerDirectory: 1, maxBytes: 0 } })

    // then
    expect(text).toContain("reference/***/: a.md (+1 more; read $MEMORY_DIR/reference/ to list)")
  })

  it("#given long names and a budget below the floor #when rendered #then the floor render is returned and the overflow is reported", () => {
    // given
    const long = "a-name-long-enough-to-outweigh-its-omitted-names-marker"
    const paths = [`${long}.md`, ...Array.from({ length: 8 }, (_, index) => `a/${long}-${index}.md`), `b/${long}.md`]
    const input = { times: at({}), limits: { maxEntriesPerDirectory: 0, maxBytes: 1 } }

    // when
    const text = renderExternalProjection(paths, input)
    const stats = renderExternalProjectionStats(paths, input)

    // then
    expect(text).toBe([
      "<external_projection>",
      "$MEMORY_DIR/: (+1 more; read $MEMORY_DIR/ to list)",
      "a/: (+8 more; read $MEMORY_DIR/a/ to list)",
      "b/: (+1 more; read $MEMORY_DIR/b/ to list)",
      "</external_projection>",
    ].join("\n"))
    expect(stats).toEqual({ shown: 0, omitted: 10, bytes: bytes(text), maxBytes: 1, overflow: true, recencyUnavailable: false })
  })

  it("#given short names whose full listing is smaller than the floor #when the budget is below both #then the full listing is returned and the overflow is reported", () => {
    // given
    const paths = ["ARCHIVE.md", "a/x.md", "a/y.md", "b/z.md"]
    const input = { times: at({}), limits: { maxEntriesPerDirectory: 0, maxBytes: 1 } }

    // when
    const text = renderExternalProjection(paths, input)
    const stats = renderExternalProjectionStats(paths, input)

    // then
    expect(text).toBe(renderExternalProjection(paths))
    expect(stats).toEqual({ shown: 4, omitted: 0, bytes: bytes(text), maxBytes: 1, overflow: true, recencyUnavailable: false })
  })

  it("#given equal commit times #when ordered #then names break the tie, and names without a time come last", () => {
    // given
    const paths = ["d/b.md", "d/a.md", "d/untimed.md", "d/new.md"]
    const times = at({ "d/b.md": 5, "d/a.md": 5, "d/new.md": 9 })

    // when
    const text = renderExternalProjection(paths, { times, limits: { maxEntriesPerDirectory: 10, maxBytes: 0 } })

    // then
    expect(text.split("\n")).toContain("d/: new.md, a.md, b.md, untimed.md")
  })

  it("#given a render within both limits #when counted #then nothing is omitted and the bytes are exact", () => {
    // given
    const paths = ["d/a.md", "d/b.md"]
    const input = { times: at({ "d/a.md": 1, "d/b.md": 2 }), limits: { maxEntriesPerDirectory: 40, maxBytes: 24_576 } }

    // when
    const stats = renderExternalProjectionStats(paths, input)

    // then
    expect(stats).toEqual({
      shown: 2, omitted: 0, bytes: bytes(renderExternalProjection(paths, input)), maxBytes: 24_576, overflow: false, recencyUnavailable: false,
    })
  })
})
