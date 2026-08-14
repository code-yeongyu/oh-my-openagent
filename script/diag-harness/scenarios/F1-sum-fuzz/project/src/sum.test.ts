import { expect, test } from "bun:test"
import { total, modalCount } from "./sum"
test("total", () => expect(total).toBe(186))
test("modalCount", () => expect(modalCount).toBe(7))
