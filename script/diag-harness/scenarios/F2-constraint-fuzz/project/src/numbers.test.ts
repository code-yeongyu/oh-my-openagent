import { expect, test } from "bun:test"
import data from "./data.json"
import { median } from "./numbers"
test("median", () => expect(median(data.values)).toBe(523))
