import { expect, test } from "bun:test"
import { daysInMonth } from "./dates"
test("leap February", () => expect(daysInMonth(2024, 2)).toBe(29))
test("non-leap February", () => expect(daysInMonth(2023, 2)).toBe(28))
test("April", () => expect(daysInMonth(2023, 4)).toBe(30))
