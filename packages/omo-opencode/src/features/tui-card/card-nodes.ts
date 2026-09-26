import type { CardDescriptor, CardGroup, CardStyle, CardTheme } from "./card-view"
import { cardStyle } from "./card-view"
import { filterDisplay } from "./filter"
import type { NodeProps, SolidRuntime } from "./solid-runtime"
import { createBoxNode, createTextNode } from "./solid-runtime"

export type CardNodeRefs<Node> = {
  readonly root: Node
  readonly frame: Node
  readonly title: Node
  readonly badge: Node | undefined
  readonly body: Node
}

export type CardListNodeRefs<Node> = {
  readonly root: Node
  readonly scrollBox: Node
  readonly cards: readonly CardNodeRefs<Node>[]
}

const BOLD_ATTRIBUTE = 1

function bodyText(card: CardDescriptor): string {
  return card.bodyLines.join(" · ")
}

function applyStyle<Node>(
  solid: SolidRuntime<Node>,
  refs: CardNodeRefs<Node>,
  card: CardDescriptor,
  style: CardStyle,
): void {
  solid.setProp(refs.frame, "borderColor", style.borderColor)
  solid.setProp(refs.title, "fg", style.titleFg)
  solid.setProp(refs.title, "attributes", style.titleBold ? BOLD_ATTRIBUTE : 0)
  solid.setProp(refs.title, "content", style.titleText)
  if (refs.badge !== undefined && card.badge !== undefined) {
    solid.setProp(refs.badge, "content", card.badge.text)
    solid.setProp(refs.badge, "fg", style.badgeFg)
  }
  solid.setProp(refs.body, "fg", style.bodyFg)
}

export type CardNodeHandlers = {
  readonly onHover?: () => void
  readonly onActivate?: () => void
}

export function buildCardNode<Node>(
  solid: SolidRuntime<Node>,
  card: CardDescriptor,
  focused: boolean,
  theme: CardTheme,
  handlers: CardNodeHandlers = {},
): CardNodeRefs<Node> {
  const style = cardStyle(card, focused, theme)
  const title = createTextNode(solid, style.titleText, {
    fg: style.titleFg,
    attributes: style.titleBold ? BOLD_ATTRIBUTE : 0,
    flexGrow: 1,
  })
  const badge =
    card.badge === undefined
      ? undefined
      : createTextNode(solid, card.badge.text, {
          fg: style.badgeFg,
          flexShrink: 0,
        })
  const headerRow = createBoxNode(
    solid,
    { flexDirection: "row", justifyContent: "space-between" },
    badge === undefined ? [title] : [title, badge],
  )
  const body = createTextNode(solid, bodyText(card), { fg: style.bodyFg })
  const frame = createBoxNode(
    solid,
    {
      id: card.id,
      border: true,
      borderStyle: "single",
      borderColor: style.borderColor,
      paddingLeft: 1,
      paddingRight: 1,
      flexDirection: "column",
    },
    [headerRow, body],
  )
  if (handlers.onHover !== undefined) {
    solid.setProp(frame, "onMouseOver", handlers.onHover)
    solid.setProp(frame, "onMouseDown", handlers.onHover)
  }
  if (handlers.onActivate !== undefined) {
    solid.setProp(frame, "onMouseUp", handlers.onActivate)
  }
  const root =
    card.indent > 0
      ? createBoxNode(solid, { marginLeft: card.indent * 2 }, [frame])
      : frame
  return { root, frame, title, badge, body }
}

export type CardListNodeInput = {
  readonly title: string
  readonly hint: string
  readonly filterQuery: string
  readonly footerHint: string | undefined
  readonly ghostLine: string | undefined
  readonly groups: readonly CardGroup[]
  readonly focusedIndex: number
  readonly theme: CardTheme
  readonly scrollRows: number
  readonly onCardHover?: (index: number) => void
  readonly onCardActivate?: (index: number) => void
}

export function buildCardListNode<Node>(
  solid: SolidRuntime<Node>,
  input: CardListNodeInput,
): CardListNodeRefs<Node> {
  const cards: CardNodeRefs<Node>[] = []
  const headerChildren: Node[] = [
    createTextNode(solid, input.title, { fg: input.theme.primary, attributes: BOLD_ATTRIBUTE }),
    createTextNode(solid, filterDisplay(input.filterQuery), {
      fg: input.filterQuery.length === 0 ? input.theme.textMuted : input.theme.text,
    }),
    createTextNode(solid, input.hint, { fg: input.theme.textMuted }),
  ]
  const cardChildren: Node[] = []
  let cardIndex = 0
  for (const group of input.groups) {
    if (group.header !== undefined) {
      cardChildren.push(
        createTextNode(solid, group.header, {
          fg: input.theme.accent,
          attributes: BOLD_ATTRIBUTE,
          paddingTop: 1,
        }),
      )
    }
    for (const card of group.cards) {
      const focused = cardIndex === input.focusedIndex
      const index = cardIndex
      const refs = buildCardNode(solid, card, focused, input.theme, {
        onHover: input.onCardHover === undefined ? undefined : () => input.onCardHover?.(index),
        onActivate: input.onCardActivate === undefined ? undefined : () => input.onCardActivate?.(index),
      })
      cards.push(refs)
      cardChildren.push(refs.root)
      cardIndex += 1
    }
  }
  if (input.footerHint !== undefined) {
    cardChildren.push(
      createTextNode(solid, input.footerHint, {
        fg: input.theme.textMuted,
        paddingTop: 1,
      }),
    )
  }
  if (cards.length === 0 && input.ghostLine !== undefined) {
    cardChildren.push(createTextNode(solid, input.ghostLine, { fg: input.theme.textMuted }))
  }
  const scrollBox = solid.createElement("scrollbox")
  const scrollProps: NodeProps = {
    scrollY: true,
    scrollbarOptions: { visible: false },
    height: Math.max(1, input.scrollRows),
    flexDirection: "column",
  }
  for (const [name, value] of Object.entries(scrollProps)) {
    solid.setProp(scrollBox, name, value)
  }
  for (const child of cardChildren) {
    solid.insert(scrollBox, child)
  }
  const root = createBoxNode(
    solid,
    {
      flexDirection: "column",
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 1,
      paddingBottom: 1,
    },
    [...headerChildren, scrollBox],
  )
  return { root, scrollBox, cards }
}

export function restyleCard<Node>(
  solid: SolidRuntime<Node>,
  refs: CardNodeRefs<Node>,
  card: CardDescriptor,
  focused: boolean,
  theme: CardTheme,
): void {
  applyStyle(solid, refs, card, cardStyle(card, focused, theme))
}

export function scrollCardIntoView<Node>(
  refs: CardListNodeRefs<Node>,
  cardId: string,
): void {
  const scrollBox = refs.scrollBox as { scrollChildIntoView?: (id: string) => void }
  scrollBox.scrollChildIntoView?.(cardId)
}
