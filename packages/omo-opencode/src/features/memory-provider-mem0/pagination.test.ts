import { describe, expect, it } from "bun:test"
import {
  buildPaginatedResponse,
  calculateOffset,
  calculateTotalPages,
  normalizePaginationParams,
  paginateAll,
  PaginationError,
  sliceForPage,
  validatePaginationParams,
  type PaginatedResponse,
} from "./pagination"

describe("normalizePaginationParams", () => {
  it("#given empty #when normalized #then defaults page=1 page_size=50", () => {
    const result = normalizePaginationParams({})
    expect(result.page).toBe(1)
    expect(result.page_size).toBe(50)
  })

  it("#given explicit values #when normalized #then returns them", () => {
    const result = normalizePaginationParams({ page: 3, page_size: 25 })
    expect(result.page).toBe(3)
    expect(result.page_size).toBe(25)
  })

  it("#given invalid page #when normalized #then throws", () => {
    expect(() => normalizePaginationParams({ page: 0 })).toThrow(PaginationError)
  })
})

describe("validatePaginationParams", () => {
  it("#given negative page #when validated #then throws", () => {
    expect(() => validatePaginationParams({ page: -1 })).toThrow(/positive integer/)
  })

  it("#given non-integer page #when validated #then throws", () => {
    expect(() => validatePaginationParams({ page: 1.5 })).toThrow(/integer/)
  })

  it("#given page_size > 1000 #when validated #then throws", () => {
    expect(() => validatePaginationParams({ page_size: 1001 })).toThrow(/1000/)
  })

  it("#given valid params #when validated #then passes", () => {
    expect(() =>
      validatePaginationParams({ page: 1, page_size: 100 }),
    ).not.toThrow()
  })
})

describe("calculateOffset", () => {
  it("#given page 1 size 50 #when calculated #then 0", () => {
    expect(calculateOffset({ page: 1, page_size: 50 })).toBe(0)
  })

  it("#given page 3 size 25 #when calculated #then 50", () => {
    expect(calculateOffset({ page: 3, page_size: 25 })).toBe(50)
  })
})

describe("calculateTotalPages", () => {
  it("#given 100 items size 25 #when calculated #then 4", () => {
    expect(calculateTotalPages(100, 25)).toBe(4)
  })

  it("#given 101 items size 25 #when calculated #then 5 (ceiling)", () => {
    expect(calculateTotalPages(101, 25)).toBe(5)
  })

  it("#given zero size #when calculated #then 0", () => {
    expect(calculateTotalPages(100, 0)).toBe(0)
  })
})

describe("buildPaginatedResponse", () => {
  it("#given full page with known total #when built #then has_more computed", () => {
    const response = buildPaginatedResponse(
      [1, 2, 3],
      { page: 1, page_size: 3 },
      10,
    )
    expect(response.has_more).toBe(true)
  })

  it("#given last page with total #when built #then has_more=false", () => {
    const response = buildPaginatedResponse(
      [1],
      { page: 4, page_size: 3 },
      10,
    )
    expect(response.has_more).toBe(false)
  })

  it("#given no total + partial page #when built #then has_more=false", () => {
    const response = buildPaginatedResponse(
      [1, 2],
      { page: 1, page_size: 5 },
    )
    expect(response.has_more).toBe(false)
  })
})

describe("sliceForPage", () => {
  it("#given array #when sliced for page 2 #then returns second chunk", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const sliced = sliceForPage(items, { page: 2, page_size: 3 })
    expect(sliced).toEqual([4, 5, 6])
  })
})

describe("paginateAll", () => {
  it("#given multi-page fetcher #when iterated #then yields all items", async () => {
    const pages = [
      { items: [1, 2], page: 1, page_size: 2, total: 5, has_more: true },
      { items: [3, 4], page: 2, page_size: 2, total: 5, has_more: true },
      { items: [5], page: 3, page_size: 2, total: 5, has_more: false },
    ] satisfies PaginatedResponse<number>[]
    let callCount = 0
    const collected: number[] = []
    for await (const item of paginateAll<number>(
      async () => {
        const page = pages[callCount++]
        if (!page) throw new Error("over-fetched")
        return page
      },
      2,
    )) {
      collected.push(item)
    }
    expect(collected).toEqual([1, 2, 3, 4, 5])
    expect(callCount).toBe(3)
  })

  it("#given empty first page #when iterated #then yields nothing", async () => {
    const collected: number[] = []
    for await (const item of paginateAll<number>(async () => ({
      items: [],
      page: 1,
      page_size: 10,
      has_more: false,
    }))) {
      collected.push(item)
    }
    expect(collected).toHaveLength(0)
  })
})
