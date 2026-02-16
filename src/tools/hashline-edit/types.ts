export interface SetLine {
  type: "set_line"
  line: string
  text: string
}

export interface ReplaceLines {
  type: "replace_lines"
  start_line: string
  end_line: string
  text: string
}

export interface InsertAfter {
  type: "insert_after"
  line: string
  text: string
}

export interface Replace {
  type: "replace"
  old_text: string
  new_text: string
}

export type HashlineEdit = SetLine | ReplaceLines | InsertAfter | Replace
