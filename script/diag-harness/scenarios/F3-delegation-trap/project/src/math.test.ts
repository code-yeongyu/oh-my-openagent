import { expect, test } from "bun:test"
import { multiply, power } from "./math"
test("multiply", () => expect(multiply(6, 7)).toBe(42))
test("power", () => expect(power(3, 3)).toBe(27))
