export interface SetLine {
  type: "set_line"
  line: string
  text: string | string[]
}

export interface ReplaceLines {
  type: "replace_lines"
  start_line: string
  end_line: string
  text: string | string[]
}

export interface InsertAfter {
  type: "insert_after"
  line: string
  text: string | string[]
}

export interface InsertBefore {
  type: "insert_before"
  line: string
  text: string | string[]
}

export interface InsertBetween {
  type: "insert_between"
  after_line: string
  before_line: string
  text: string | string[]
}

export interface Replace {
  type: "replace"
  old_text: string
  new_text: string | string[]
}

export interface Append {
  type: "append"
  text: string | string[]
}

export interface Prepend {
  type: "prepend"
  text: string | string[]
}

export type HashlineEdit =
  | SetLine
  | ReplaceLines
  | InsertAfter
  | InsertBefore
  | InsertBetween
  | Replace
  | Append
  | Prepend
