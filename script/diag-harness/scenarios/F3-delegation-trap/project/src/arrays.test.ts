import { expect, test } from "bun:test"
import { last, unique } from "./arrays"
test("last", () => expect(last([1, 2, 3])).toBe(3))
test("unique", () => expect(unique([3, 1, 3, 2, 1])).toEqual([3, 1, 2]))
