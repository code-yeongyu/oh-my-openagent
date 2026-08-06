declare module "@opentui/solid" {
  export function createElement(tag: string): unknown
  export function insert(parent: unknown, child: unknown): unknown
  export function setProp(node: unknown, name: string, value: unknown): unknown
}
