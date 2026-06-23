export interface PaginationParams {
  page?: number
  page_size?: number
}

export interface PaginatedResponse<T> {
  items: T[]
  page: number
  page_size: number
  total?: number
  has_more: boolean
}

export class PaginationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PaginationError"
  }
}

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 1000

export function normalizePaginationParams(
  params: PaginationParams,
): Required<PaginationParams> {
  const page = params.page ?? DEFAULT_PAGE
  const page_size = params.page_size ?? DEFAULT_PAGE_SIZE
  validatePaginationParams({ page, page_size })
  return { page, page_size }
}

export function validatePaginationParams(params: PaginationParams): void {
  if (params.page !== undefined) {
    if (!Number.isInteger(params.page) || params.page < 1) {
      throw new PaginationError(
        `page must be a positive integer (got ${params.page})`,
      )
    }
  }
  if (params.page_size !== undefined) {
    if (!Number.isInteger(params.page_size) || params.page_size < 1) {
      throw new PaginationError(
        `page_size must be a positive integer (got ${params.page_size})`,
      )
    }
    if (params.page_size > MAX_PAGE_SIZE) {
      throw new PaginationError(
        `page_size exceeds max ${MAX_PAGE_SIZE} (got ${params.page_size})`,
      )
    }
  }
}

export function buildPaginatedResponse<T>(
  items: T[],
  params: Required<PaginationParams>,
  total?: number,
): PaginatedResponse<T> {
  const has_more =
    total !== undefined
      ? params.page * params.page_size < total
      : items.length === params.page_size
  return {
    items,
    page: params.page,
    page_size: params.page_size,
    total,
    has_more,
  }
}

export function calculateOffset(params: Required<PaginationParams>): number {
  return (params.page - 1) * params.page_size
}

export function calculateTotalPages(
  total: number,
  page_size: number,
): number {
  if (page_size <= 0) return 0
  return Math.ceil(total / page_size)
}

export async function* paginateAll<T>(
  fetchPage: (params: Required<PaginationParams>) => Promise<PaginatedResponse<T>>,
  page_size = DEFAULT_PAGE_SIZE,
): AsyncIterableIterator<T> {
  let page = 1
  while (true) {
    const response = await fetchPage({ page, page_size })
    for (const item of response.items) {
      yield item
    }
    if (!response.has_more || response.items.length === 0) {
      break
    }
    page++
  }
}

export function sliceForPage<T>(
  items: T[],
  params: Required<PaginationParams>,
): T[] {
  const offset = calculateOffset(params)
  return items.slice(offset, offset + params.page_size)
}
