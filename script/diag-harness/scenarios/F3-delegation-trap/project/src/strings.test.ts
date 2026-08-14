import { expect, test } from "bun:test"
import { reverse, countWords } from "./strings"
test("reverse", () => expect(reverse("abc")).toBe("cba"))
test("countWords", () => expect(countWords("a b c d")).toBe(4))
