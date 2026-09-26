import { describe, expect, it } from "bun:test"

import { buildCardListNode } from "./card-nodes"
import type { CardDescriptor, CardTheme } from "./card-view"

type TestNode = { tag: string; props: Record<string, unknown>; children: unknown[] }

function createSolid() {
  return {
    createElement: (tag: string): TestNode => ({ tag, props: {}, children: [] }),
    insert: (node: TestNode, child: unknown) => {
      node.children.push(child)
    },
    setProp: (node: TestNode, name: string, value: unknown) => {
      node.props[name] = value
    },
  }
}

const theme: CardTheme = {
  primary: "#",
  accent: "#",
  success: "#",
  error: "#",
  warning: "#",
  text: "#",
  textMuted: "#",
  borderActive: "#",
  borderSubtle: "#",
}

function card(id: string): CardDescriptor {
  return { id, title: id, badge: undefined, bodyLines: ["body"], indent: 0 }
}

function findById(node: TestNode, id: string): TestNode | undefined {
  if (node.props.id === id) return node
  for (const child of node.children) {
    if (child !== null && typeof child === "object" && "props" in child) {
      const found = findById(child as TestNode, id)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function baseInput(cards: readonly CardDescriptor[]) {
  return {
    title: "t",
    hint: "h",
    filterQuery: "",
    footerHint: undefined,
    ghostLine: undefined,
    groups: [{ header: undefined, cards }],
    focusedIndex: 0,
    theme,
    scrollRows: 10,
  }
}

describe("buildCardListNode mouse handlers", () => {
  it("#given hover and activate callbacks #when cards are built #then each frame wires mouse events to its index", () => {
    const solid = createSolid()
    const hovered: number[] = []
    const activated: number[] = []
    const refs = buildCardListNode(solid, {
      ...baseInput([card("a"), card("b")]),
      onCardHover: (index) => hovered.push(index),
      onCardActivate: (index) => activated.push(index),
    })

    const frameA = findById(refs.root, "a")
    const frameB = findById(refs.root, "b")
    expect(typeof frameA?.props.onMouseOver).toBe("function")
    expect(typeof frameA?.props.onMouseDown).toBe("function")
    expect(typeof frameA?.props.onMouseUp).toBe("function")

    ;(frameB?.props.onMouseUp as () => void)()
    ;(frameA?.props.onMouseOver as () => void)()

    expect(activated).toEqual([1])
    expect(hovered).toEqual([0])
  })

  it("#given no callbacks #when cards are built #then no mouse props are set", () => {
    const solid = createSolid()
    const refs = buildCardListNode(solid, baseInput([card("a")]))

    const frameA = findById(refs.root, "a")
    expect(frameA?.props.onMouseUp).toBeUndefined()
    expect(frameA?.props.onMouseOver).toBeUndefined()
    expect(frameA?.props.onMouseDown).toBeUndefined()
  })
})
