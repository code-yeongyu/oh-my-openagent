export type ViewNodeKind = "box" | "text"

export type ViewNode = {
  readonly kind: ViewNodeKind
  readonly props: Readonly<Record<string, unknown>>
  readonly text?: string
  readonly children?: readonly ViewNode[]
}

export function box(props: Readonly<Record<string, unknown>>, children: readonly ViewNode[] = []): ViewNode {
  return { kind: "box", props, children }
}

export function text(props: Readonly<Record<string, unknown>>, value: string): ViewNode {
  return { kind: "text", props, text: value }
}
