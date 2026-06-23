import type { L2FilterLeaf, L2FilterNode, L2FilterOperator } from "../memory-provider-core/types"

export type { L2FilterLeaf, L2FilterNode, L2FilterOperator }

export function filterEq(field: string, value: string | number): L2FilterNode {
  return { AND: [{ field, value }] }
}

export function filterAnd(...conditions: L2FilterNode[]): L2FilterNode {
  return { AND: conditions }
}

export function filterOr(...conditions: L2FilterNode[]): L2FilterNode {
  return { OR: conditions }
}

export function filterNot(condition: L2FilterNode): L2FilterNode {
  return { NOT: condition }
}

export function filterRange(field: string, gte?: string, lte?: string): L2FilterNode {
  const leaves: L2FilterLeaf[] = []
  if (gte) leaves.push({ field, operator: "gte", value: gte })
  if (lte) leaves.push({ field, operator: "lte", value: lte })
  return { AND: leaves }
}

export function validateFilter(filter: L2FilterNode): { valid: boolean; missingRequired?: string } {
  const serialized = JSON.stringify(filter)
  if (!serialized.includes("user_id")) {
    return { valid: false, missingRequired: "user_id" }
  }
  return { valid: true }
}

export function buildSafeFilter(user_id: string, extra?: L2FilterNode): L2FilterNode {
  const userFilter: L2FilterNode = { field: "user_id", value: user_id }
  if (!extra) return filterAnd(userFilter)
  return filterAnd(userFilter, extra)
}
