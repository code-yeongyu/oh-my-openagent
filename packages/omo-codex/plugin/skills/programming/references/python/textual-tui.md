# Textual TUI

Textual builds rich, mouse-aware, scrollable, mobile-style TUIs on top of `rich`. Replaces curses, urwid, blessed.

## Install

```bash
uv add textual
uv add --dev textual-dev   # textual console + run --dev for hot reload
```

## Minimal app

```python
from textual.app import App, ComposeResult
from textual.widgets import Header, Footer, Button, Label
from textual.containers import Vertical


class CounterApp(App[None]):
    """A trivial counter app."""

    BINDINGS = [("q", "quit", "Quit")]
    CSS = """
    #count {
        height: 3;
        content-align: center middle;
        background: $boost;
    }
    """

    count: int = 0

    def compose(self) -> ComposeResult:
        yield Header()
        with Vertical():
            yield Label("0", id="count")
            yield Button("Increment", id="inc", variant="primary")
            yield Button("Reset", id="reset", variant="warning")
        yield Footer()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "inc":
            self.count += 1
        elif event.button.id == "reset":
            self.count = 0
        self.query_one("#count", Label).update(str(self.count))


if __name__ == "__main__":
    CounterApp().run()
```

Run:

```bash
uv run python counter.py
```

For hot reload during development:

```bash
uv run textual run --dev counter.py
```

## Reactive attributes

Textual's `reactive()` descriptor turns a class attribute into something that watches assignments and re-renders automatically. Replaces the manual `query_one` + `update` dance.

```python
from textual.app import App, ComposeResult
from textual.reactive import reactive
from textual.widgets import Label


class CountWidget(Label):
    count: reactive[int] = reactive(0)

    def render(self) -> str:
        return f"Count: {self.count}"


class CounterApp(App[None]):
    def compose(self) -> ComposeResult:
        yield CountWidget()

    def on_key(self, event) -> None:
        if event.key == "space":
            self.query_one(CountWidget).count += 1
```

`reactive()` triggers `render()` (or `watch_<attr>` and `validate_<attr>` callbacks if defined). Use `recompose=True` if you need to call `compose()` again on change.

## Async work — workers

NEVER block the event loop. For network/disk/CPU work, use `@work` (creates a worker) or `run_worker`.

```python
import httpx
from textual.app import App, ComposeResult
from textual.widgets import Input, Static
from textual.work import work


class FetchApp(App[None]):
    def compose(self) -> ComposeResult:
        yield Input(placeholder="URL", id="url")
        yield Static(id="result")

    @work(exclusive=True)
    async def fetch(self, url: str) -> None:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url)
        self.query_one("#result", Static).update(f"{response.status_code} - {len(response.text)} bytes")

    def on_input_submitted(self, event: Input.Submitted) -> None:
        self.fetch(event.value)
```

`exclusive=True` cancels the previous worker if the user submits a new URL before the first finishes. Workers integrate with Textual's lifecycle - they're cancelled when the app exits.

`@work` is asyncio-flavoured under the hood. That is fine - it does not violate the no-asyncio rule because you are calling Textual's API, not importing asyncio yourself. Inside the worker body, use `httpx.AsyncClient` and other anyio-friendly libraries.

## Action handlers

Bind keys to method calls via `BINDINGS` and `action_*` methods.

```python
class App(App):
    BINDINGS = [
        ("ctrl+s", "save", "Save"),
        ("ctrl+r", "reload", "Reload"),
    ]

    def action_save(self) -> None:
        # Called on ctrl+s
        ...

    def action_reload(self) -> None:
        ...
```

Bindings can also include the `priority=True` flag to fire before children get a chance.

## CSS

Textual's CSS supports selectors, variables (`$primary`, `$boost`), animations. Inline via `CSS = "..."` or external via `CSS_PATH = "app.tcss"`.

```css
Screen {
    background: $surface;
    color: $text;
    layout: vertical;
}

#sidebar {
    width: 30;
    background: $boost;
}

Button.danger {
    background: $error;
}
```

Reload with `r` in dev mode (`textual run --dev`).

## Testing

```python
import pytest
from myapp import CounterApp


@pytest.mark.anyio
async def test_counter_increments() -> None:
    app = CounterApp()
    async with app.run_test() as pilot:
        await pilot.click("#inc")
        await pilot.click("#inc")
        assert app.count == 2
```

`pilot.click(selector)`, `pilot.press("q")`, `pilot.pause()` for waiting on the next frame.

## When NOT to use Textual

| Need | Use |
|---|---|
| One-off CLI with structured output | typer + rich |
| Progress bar in a script | rich.progress |
| Tabular display of query results | rich.table |
| Full-screen app with state, input, mouse | Textual |

A pretty CLI is not a TUI. Reach for Textual when the user expects to navigate a UI, not when you want colours.

## Sources

- Textual docs: <https://textual.textualize.io>
- Textual tutorial: <https://textual.textualize.io/tutorial/>
- API reference: <https://textual.textualize.io/api/>
