import type { CommentInfo, CommentFilter } from "../types"
import { filterBddComments } from "./bdd"
import { filterDirectiveComments } from "./directive"
import { filterDocstringComments } from "./docstring"
import { filterShebangComments } from "./shebang"

export { filterBddComments, filterDirectiveComments, filterDocstringComments, filterShebangComments }

const ALL_FILTERS: CommentFilter[] = [
  filterShebangComments,
  filterBddComments,
  filterDirectiveComments,
  filterDocstringComments,
]

export function applyFilters(comments: CommentInfo[]): CommentInfo[] {
  return comments.filter((comment) => {
    for (const filter of ALL_FILTERS) {
      const result = filter(comment)
      if (result.shouldSkip) {
        return false
      }
    }
    return true
  })
}
