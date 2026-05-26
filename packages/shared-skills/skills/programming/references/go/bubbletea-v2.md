# Bubbletea v2 — TUI with First-Class CJK / IME Support

The TUI stack for 2026. Use **v2 RC**, not v1. If your users include Korean, Japanese, or Chinese speakers, v1 is broken — IME composition lands in the wrong cells. v2 fixes this. This document is the canonical setup.

The reference implementation this document is distilled from: [`code-yeongyu/bubbletea-wm`](https://github.com/code-yeongyu/bubbletea-wm) — a floating window manager built specifically to nail down v2 + IME.

---

## Why v2 (not v1) — the IME story

Bubbletea v1 manages cursor positioning in software ("virtual cursor"). It draws a `█` at the cursor position. The terminal's *real* cursor stays at `(0, 0)`.

This breaks every CJK input method. IME candidate windows (the popup showing 가/각/간 for Korean Hangul composition, kana → kanji for Japanese, pinyin lookup for Chinese) anchor to the terminal's **real** cursor position. With v1, the candidate window appears at top-left while you are typing somewhere in the middle of the screen.

Bubbletea v2 fixes this with two changes:

1. **`tea.View{Cursor: *tea.Cursor}`** — your `View()` method returns a view that *includes* the desired cursor position. The framework moves the terminal's real cursor there.
2. **`textarea.SetVirtualCursor(false)`** — textareas no longer draw their own `█`. They expose `.Cursor()` so you can read where they want the real cursor.

Together: IME popups appear where the user is typing. As they should.

### Other v2 wins (incidental)

- `tea.MouseClickMsg` / `MouseMotionMsg` / `MouseReleaseMsg` instead of one coarse `MouseMsg`.
- Cleaner `View` struct with `AltScreen`, `MouseMode` fields instead of `tea.Cmd` setters.
- Pluggable rendering pipeline; better performance under high message volume.

---

## `go.mod`

```go
module github.com/your-org/mytui

go 1.23

require (
    charm.land/bubbletea/v2 v2.0.0-rc.2
    charm.land/bubbles/v2   v2.0.0-rc.1
    charm.land/lipgloss/v2  v2.0.0-beta.3
    github.com/mattn/go-runewidth v0.0.19
)
```

The packages live under `charm.land/` (NOT `github.com/charmbracelet/...`) for v2. This is the Charm team's deliberate import-path break to keep v2 separate from v1 until stable.

---

## Minimal app — the IME-correct skeleton

```go
package main

import (
    "fmt"
    "log"

    tea "charm.land/bubbletea/v2"
    "charm.land/bubbles/v2/textarea"
)

type model struct {
    width, height int
    ta            textarea.Model
}

func initial() model {
    ta := textarea.New()
    ta.Placeholder = "Type Korean / Japanese / Chinese here..."
    ta.SetWidth(60)
    ta.SetHeight(10)
    ta.SetVirtualCursor(false)  // ← THE LINE. Without this, IME breaks.
    ta.Focus()
    return model{ta: ta}
}

func (m model) Init() tea.Cmd { return textarea.Blink }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    switch msg := msg.(type) {
    case tea.WindowSizeMsg:
        m.width, m.height = msg.Width, msg.Height
    case tea.KeyPressMsg:
        if msg.String() == "ctrl+c" {
            return m, tea.Quit
        }
    }
    var cmd tea.Cmd
    m.ta, cmd = m.ta.Update(msg)
    return m, cmd
}

func (m model) View() tea.View {
    var view tea.View
    view.AltScreen = true
    view.SetContent(m.ta.View())

    // ── THE OTHER LINE. Position the REAL cursor for IME. ──
    if cursor := m.ta.Cursor(); cursor != nil {
        view.Cursor = cursor
    }
    return view
}

func main() {
    if _, err := tea.NewProgram(initial(), tea.WithAltScreen()).Run(); err != nil {
        log.Fatal(err)
    }
    fmt.Println("bye")
}
```

The two lines that matter:

1. `ta.SetVirtualCursor(false)` — disables the virtual `█`.
2. `view.Cursor = cursor` (where `cursor = m.ta.Cursor()`) — exports the real cursor position to the framework.

Without **both**, IME breaks.

---

## CJK width — go-runewidth, not `len()`

Korean, Japanese, Chinese characters render as **two terminal cells** (wide characters per Unicode East Asian Width). Naive `len(string)` returns byte count, not display width. `utf8.RuneCountInString` returns rune count, also not display width.

Use `github.com/mattn/go-runewidth`:

```go
import "github.com/mattn/go-runewidth"

func displayWidth(s string) int {
    return runewidth.StringWidth(s)
}

// Wide character occupies two cells; pad accordingly
for _, r := range s {
    cell := string(r)
    w := runewidth.RuneWidth(r)
    canvas = append(canvas, cell)
    if w == 2 {
        canvas = append(canvas, "")  // placeholder for second cell
    }
}
```

`lipgloss/v2` uses `go-runewidth` internally — `lipgloss.Width("안녕")` returns 4, not 2. **If you measure outside lipgloss, you must call runewidth directly.**

---

## Mouse — v2 has typed events

```go
case tea.MouseClickMsg:
    // msg.X, msg.Y, msg.Button
    return m.handleClick(msg.X, msg.Y, msg.Button)

case tea.MouseMotionMsg:
    return m.handleHover(msg.X, msg.Y)

case tea.MouseReleaseMsg:
    return m.handleRelease(msg.X, msg.Y)
```

Enable mouse via the `View`:

```go
view.MouseMode = tea.MouseModeCellMotion  // or MouseModeAll
```

`CellMotion` reports clicks + motion-while-button-pressed (drag). `MouseModeAll` reports motion always — heavier, only when you need hover.

---

## Components from `bubbles/v2`

```go
import (
    "charm.land/bubbles/v2/textarea"
    "charm.land/bubbles/v2/textinput"
    "charm.land/bubbles/v2/spinner"
    "charm.land/bubbles/v2/viewport"
    "charm.land/bubbles/v2/list"
    "charm.land/bubbles/v2/table"
    "charm.land/bubbles/v2/help"
    "charm.land/bubbles/v2/key"
)
```

All v2 components support `SetVirtualCursor(false)` where they accept text input. Use it for every text input that users might type CJK into — and "might" should be assumed *yes*.

---

## Styling — `lipgloss/v2`

```go
import "charm.land/lipgloss/v2"

titleStyle := lipgloss.NewStyle().
    Bold(true).
    Foreground(lipgloss.Color("230")).
    Background(lipgloss.Color("62")).
    Padding(0, 1).
    Border(lipgloss.RoundedBorder()).
    BorderForeground(lipgloss.Color("63"))

rendered := titleStyle.Render("안녕하세요")
```

`lipgloss/v2` width and padding correctly account for CJK display width. v1 did too — this is not a v2-specific fix, just a reminder.

---

## Architecture pattern — Model–Update–View

```
+--------------------------------------------+
|  tea.Program runs the event loop           |
|                                            |
|  loop:                                     |
|    msg <- queue                            |
|    model, cmd = model.Update(msg)          |
|    view = model.View()                     |
|    render(view)                            |
|    if cmd != nil: go run(cmd) -> queue     |
+--------------------------------------------+
```

Rules:

- **Model is a value type, not a pointer.** Bubbletea calls `Update` with a value receiver and expects a new value returned. Pointer receivers cause subtle bugs where state mutation leaks across draws.
- **`Update` is pure.** No I/O. No goroutines started inline. Any I/O returns a `tea.Cmd` — Bubbletea runs it in a goroutine and feeds the result back as a message.
- **`View` is read-only.** It returns a `tea.View` without modifying state.
- **`tea.Cmd` is `func() tea.Msg`.** It runs once, returns a message, exits. For repeating work, use `tea.Tick` or a self-resending command.

```go
// One-shot command
func loadData() tea.Cmd {
    return func() tea.Msg {
        data, err := fetch()
        if err != nil { return errMsg{err} }
        return dataLoadedMsg{data}
    }
}

// Periodic
func tickEvery() tea.Cmd {
    return tea.Tick(time.Second, func(t time.Time) tea.Msg {
        return tickMsg{t}
    })
}
```

---

## Splitting the model — sub-models

```go
type model struct {
    list    list.Model
    input   textinput.Model
    spinner spinner.Model
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    var cmds []tea.Cmd
    var cmd tea.Cmd

    m.list, cmd = m.list.Update(msg)
    cmds = append(cmds, cmd)

    m.input, cmd = m.input.Update(msg)
    cmds = append(cmds, cmd)

    m.spinner, cmd = m.spinner.Update(msg)
    cmds = append(cmds, cmd)

    return m, tea.Batch(cmds...)
}
```

`tea.Batch` runs commands concurrently. The framework collects their results in the order they arrive.

When the model exceeds 250 LOC, split by sub-model into separate files:

```
internal/ui/
├── model.go          # root model orchestration
├── list.go           # list sub-model state + update + view
├── input.go          # input sub-model
└── spinner.go        # spinner sub-model
```

---

## Testing TUI code — `teatest`

```go
import "charm.land/bubbletea/v2/teatest"

func TestModel_typing_korean_keeps_cursor_in_position(t *testing.T) {
    // Given
    m := initial()
    tm := teatest.NewTestModel(t, m, teatest.WithInitialTermSize(80, 24))

    // When — simulate typing "안녕"
    tm.Send(tea.KeyPressMsg{Code: '안'})
    tm.Send(tea.KeyPressMsg{Code: '녕'})

    // Then
    out := tm.FinalOutput(t)
    require.Contains(t, string(out), "안녕")
    // Cursor should be at column 4 (two wide chars = 4 cells)
    // ...
}
```

`teatest` lets you drive the model through synthetic messages and inspect the rendered output. Pair with `autogold` snapshots for full-view regression tests.

---

## Common antipatterns

| Bad | Why | Good |
|---|---|---|
| `tea.Program` with `tea.WithoutSignals()` | Ctrl-C does not work | Default signal handling |
| Pointer receivers on Model | Bubbletea expects value semantics | Value receivers, return new model |
| `time.Sleep` inside `Update` | Blocks the event loop | `tea.Tick` or async `tea.Cmd` |
| `fmt.Println` for debug | Corrupts the rendered output | `tea.Printf` for logging, or write to a file |
| `len(s)` for CJK width | Off by 2x | `runewidth.StringWidth(s)` |
| `Bubbletea v1` for an app with text input | Korean/Japanese IME breaks | v2 + `SetVirtualCursor(false)` |
| Drawing your own `█` block cursor in v2 | Conflicts with `view.Cursor` | Let the terminal handle it |

---

## Performance — when v2 starts to crawl

- **Reduce View frequency.** If the model changes 60 times/sec but the rendered view changes once/sec, gate redraws on a "dirty" flag.
- **`viewport.Model` for scrollable content.** Avoid re-rendering thousands of lines on every keystroke.
- **`Batch` your commands.** A series of synchronous `tea.Cmd` returns serializes; `tea.Batch` parallelizes.
- **Profile with `tea.WithFPS(N)`** to cap repaint rate during development.

---

## When NOT to use Bubbletea

- The app is one prompt + one answer. Use `huh` (also from Charm) — simpler, no Model–Update–View ceremony.
- The app is a long-running daemon with occasional status output. Use `slog` to stderr and `tea.Program` only if interactivity becomes necessary.
- The app must run as a non-tty subprocess (CI, redirected stdin). `tea.Program` requires a tty for input. Detect via `term.IsTerminal(int(os.Stdin.Fd()))` and fall back to a non-interactive path.

---

## Sources

- bubbletea v2 RC: https://github.com/charmbracelet/bubbletea/tree/v2
- bubbles v2: https://github.com/charmbracelet/bubbles/tree/v2
- lipgloss v2: https://github.com/charmbracelet/lipgloss/tree/v2
- bubbletea-wm (IME reference): https://github.com/code-yeongyu/bubbletea-wm
- crush CLI (production IME impl): https://github.com/charmbracelet/crush
- go-runewidth: https://github.com/mattn/go-runewidth
- Unicode East Asian Width: https://www.unicode.org/reports/tr11/
