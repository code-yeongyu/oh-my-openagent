# Markdown block boundaries

The light Markdown model preserves the documented CommonMark paragraph interruption rule:
only an ordered marker numbered `1` interrupts an open paragraph. In
`1. a\ncontinued\n2. b`, the blocks remain a list item `a` and a paragraph
`continued\n2. b`. The model does not attach the unindented continuation to the
preceding list item. The `2` remains paragraph text with its original source
offset; fidelity numerals in either block remain available to the numeral parser.

A closing code fence permits at most three leading spaces. A candidate indented
four spaces stays code; without a later valid close the parser reports
`unterminated_fence` instead of exposing the code as report prose.
