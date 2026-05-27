import { describe, test, expect } from "bun:test";
import { isRecord } from "./record-type-guard";

describe("isRecord", () => {
	describe("#given plain objects", () => {
		test("#when empty object #then returns true", () => {
			expect(isRecord({})).toBe(true);
		});

		test("#when object with string keys #then returns true", () => {
			expect(isRecord({ a: 1, b: "hello" })).toBe(true);
		});

		test("#when object with nested properties #then returns true", () => {
			expect(isRecord({ nested: { deep: { value: 42 } } })).toBe(true);
		});

		test("#when object with mixed value types #then returns true", () => {
			expect(
				isRecord({
					str: "text",
					num: 123,
					bool: true,
					nil: null,
					undef: undefined,
				})
			).toBe(true);
		});
	});

	describe("#given null and undefined", () => {
		test("#when null #then returns false", () => {
			expect(isRecord(null)).toBe(false);
		});

		test("#when undefined #then returns false", () => {
			expect(isRecord(undefined)).toBe(false);
		});
	});

	describe("#given arrays", () => {
		test("#when empty array #then returns true", () => {
			expect(isRecord([])).toBe(true);
		});

		test("#when array with elements #then returns true", () => {
			expect(isRecord([1, 2, 3])).toBe(true);
		});

		test("#when nested array #then returns true", () => {
			expect(isRecord([[1, 2], [3, 4]])).toBe(true);
		});
	});

	describe("#given primitives", () => {
		test("#when string #then returns false", () => {
			expect(isRecord("hello")).toBe(false);
		});

		test("#when number #then returns false", () => {
			expect(isRecord(42)).toBe(false);
		});

		test("#when boolean true #then returns false", () => {
			expect(isRecord(true)).toBe(false);
		});

		test("#when boolean false #then returns false", () => {
			expect(isRecord(false)).toBe(false);
		});

		test("#when zero #then returns false", () => {
			expect(isRecord(0)).toBe(false);
		});

		test("#when empty string #then returns false", () => {
			expect(isRecord("")).toBe(false);
		});
	});

	describe("#given class instances", () => {
		test("#when Date instance #then returns true", () => {
			expect(isRecord(new Date())).toBe(true);
		});

		test("#when custom class instance #then returns true", () => {
			class CustomClass {
				value = 42;
			}
			expect(isRecord(new CustomClass())).toBe(true);
		});

		test("#when Error instance #then returns true", () => {
			expect(isRecord(new Error("test"))).toBe(true);
		});

		test("#when RegExp instance #then returns true", () => {
			expect(isRecord(/test/)).toBe(true);
		});
	});

	describe("#given nested objects", () => {
		test("#when deeply nested object #then returns true", () => {
			const deep = {
				level1: {
					level2: {
						level3: {
							level4: {
								value: "deep",
							},
						},
					},
				},
			};
			expect(isRecord(deep)).toBe(true);
		});

		test("#when object with array values #then returns true", () => {
			expect(isRecord({ items: [1, 2, 3], nested: { arr: [] } })).toBe(true);
		});

		test("#when object with function values #then returns true", () => {
			expect(isRecord({ fn: () => {}, method: (x: number) => x * 2 })).toBe(
				true
			);
		});
	});
});
