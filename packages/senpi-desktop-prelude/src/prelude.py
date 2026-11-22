# Eval-kernel `computer` global: sugar over the ordinary registered tool call `tool.computer(...)`.
# senpi's Python kernel is synchronous, so every helper returns its value directly; `verify` alone repeats read
# calls until its deadline. The method tuples in the generated region come from facade-manifest.json.
def _make_computer():
    import os
    import time

    # Children a cell starts inherit the marker, so an SDK inside them refuses to spawn a second engine.
    os.environ["SENPI_DESKTOP_HOST"] = "1"

    # <generated:facade> from facade-manifest.json by scripts/generate-assets.ts; edit CHAIN_BINDINGS there, then `bun run generate`
    _DESKTOP_METHODS = ("displays", "windows", "screenshot", "zoom", "click", "doubleClick", "move", "drag", "scroll", "type", "press", "holdKeys", "holdMouse")
    _DISPLAY_METHODS = ("screenshot", "zoom", "click", "doubleClick", "move", "drag", "scroll", "type", "press", "holdKeys", "holdMouse")
    _WINDOW_METHODS = ("screenshot", "observe", "zoom", "click", "doubleClick", "move", "drag", "scroll", "type", "press", "holdKeys", "holdMouse", "raise", "ax")
    _ELEMENT_METHODS = ("value", "setValue", "bounds", "attributes", "actions", "perform", "press", "click", "type", "focus")
    # </generated:facade>

    def _arguments(args, kwargs):
        """Positional args with trailing Nones dropped; keyword args become one trailing options dict."""
        values = list(args)
        while values and values[-1] is None:
            values.pop()
        options = {key: value for key, value in kwargs.items() if value is not None}
        if options:
            values.append(options)
        return values

    def _invoke(arguments):
        # The tool result is {text, details?, images?, hasError?}: images display, details.value is the return value.
        # A failed call's details.value.code (COMPUTER_*) rides on the raised RuntimeError as `error.code`.
        result = tool.computer(**arguments)
        if result.get("hasError"):
            details = result.get("details")
            value = details.get("value") if isinstance(details, dict) else None
            code = value.get("code") if isinstance(value, dict) else None
            error = RuntimeError(result["text"])
            error.code = code if isinstance(code, str) else None
            raise error
        for image in result.get("images") or []:
            display(image)
        details = result.get("details")
        return details.get("value") if isinstance(details, dict) else None

    def _call(chain):
        return _invoke({"action": "call", "chain": chain})

    def _step(method, args, kwargs):
        return {"method": method, "args": _arguments(args, kwargs)}

    def _chain_method(method):
        def call(self, *args, **kwargs):
            return self._method(method, args, kwargs)

        call.__name__ = method
        return call

    def _install(cls, methods):
        # Python attribute name -> chain method name; `raise_` stands in for the keyword `raise`.
        for attribute, method in methods.items():
            setattr(cls, attribute, _chain_method(method))

    def _element(snapshot):
        return _Element(snapshot) if isinstance(snapshot, dict) else None

    def _window(snapshot):
        return _Window(snapshot) if isinstance(snapshot, dict) else None

    class _Element:
        __slots__ = ("ref", "role", "nativeRole", "title", "description", "enabled", "focused", "childCount")

        def __init__(self, snapshot):
            for field in self.__slots__:
                setattr(self, field, snapshot.get(field))

        def __repr__(self):
            return f"<computer.Element ref={self.ref!r} role={self.role!r}>"

        def _method(self, method, args, kwargs):
            return _call([_step("ref", (self.ref,), {}), _step(method, args, kwargs)])

        def parent(self):
            return _element(self._method("parent", (), {}))

        def children(self):
            return [_Element(snapshot) for snapshot in self._method("children", (), {})]

    _install(_Element, {name: name for name in _ELEMENT_METHODS})

    class _Window:
        __slots__ = ("id", "app", "title", "pid", "bounds", "focused", "menu")

        def __init__(self, snapshot):
            for field in ("id", "app", "title", "pid", "bounds", "focused"):
                setattr(self, field, snapshot.get(field))
            self.menu = _Menu(self._method)

        def __repr__(self):
            return f"<computer.Window id={self.id!r} app={self.app!r}>"

        def _method(self, method, args, kwargs):
            return _call([_step("window", (self.id,), {}), _step(method, args, kwargs)])

        def find(self, *args, **kwargs):
            return [_Element(snapshot) for snapshot in self._method("find", args, kwargs)]

        def ref(self, ref):
            """Resolve a live accessibility element by its `[ref=eN]` tag."""
            return _element(_call([_step("ref", (ref,), {})]))

        def drill(self, ref, **kwargs):
            """The tree under one element of this window; the parent snapshot's refs stay valid."""
            return self._method("ax", ({**{k: v for k, v in kwargs.items() if v is not None}, "root": ref},), {})

    # `raise_` stands in for the keyword `raise`.
    _install(_Window, {("raise_" if name == "raise" else name): name for name in _WINDOW_METHODS})

    class _Display:
        __slots__ = ("id",)

        def __init__(self, snapshot):
            self.id = snapshot["id"]

        def _method(self, method, args, kwargs):
            return _call([_step("display", (self.id,), {}), _step(method, args, kwargs)])

    _install(_Display, {name: name for name in _DISPLAY_METHODS})

    class _Menu:
        __slots__ = ("_call",)

        def __init__(self, call):
            self._call = call

        def __repr__(self):
            return "<computer.Window.menu>"

        def items(self, path=None):
            return self._call("menu.items", (path,), {})

        def select(self, path, delivery=None):
            args = (path,) if delivery is None else (path, {"delivery": delivery})
            return self._call("menu.select", args, {})

    class _Clipboard:
        __slots__ = ()

        def __repr__(self):
            return "<computer.clipboard>"

        def read(self):
            return _call([_step("clipboard.read", (), {})])

        def write(self, text):
            return _call([_step("clipboard.write", (text,), {})])

    class _Control:
        __slots__ = ()

        def __repr__(self):
            return "<computer.control>"

        def acquire(self, *args, **kwargs):
            """Ask the human for the foreground-control grant; returns { active }."""
            return _call([_step("control.acquire", args, kwargs)])

        def release(self):
            """Release the foreground-control grant."""
            return _call([_step("control.release", (), {})])

        def state(self):
            """Read the foreground-control grant state."""
            return _call([_step("control.state", (), {})])

    _EXPECTATION_KINDS = ("elementExists", "elementValue", "elementEnabled", "elementSelected", "windowExists", "windowGone", "windowBounds")

    def _elapsed(started):
        return round((time.monotonic() - started) * 1000)

    def _includes(value, part):
        return part is None or str(part).lower() in str(value).lower()

    def _windows_matching(selector):
        def matches(win):
            if isinstance(selector, str):
                return win.get("id") == selector
            return (selector.get("id") is None or win.get("id") == selector["id"]) and _includes(win.get("app"), selector.get("app")) and _includes(win.get("title"), selector.get("title"))

        return [win for win in _call([_step("windows", (), {})]) or [] if matches(win)]

    def _read_element(ref, method=None):
        chain = [_step("ref", (ref,), {})]
        if method is not None:
            chain.append(_step(method, (), {}))
        return _call(chain)

    def _holds(expectation):
        """One read of the state an expectation names; raises when the read fails."""
        kind = expectation["kind"]
        if kind == "elementExists":
            wanted = expectation.get("exists", True)
            try:
                _read_element(expectation["ref"])
                return wanted
            except RuntimeError as error:
                # A ref that no longer resolves answers the question (the element is gone); other failures do not.
                if getattr(error, "code", None) == "COMPUTER_STALE_REF":
                    return not wanted
                raise
        if kind == "elementValue":
            return _read_element(expectation["ref"], "value") == expectation["value"]
        if kind == "elementEnabled":
            return (_read_element(expectation["ref"]) or {}).get("enabled") == expectation.get("enabled", True)
        if kind == "elementSelected":
            attributes = _read_element(expectation["ref"], "attributes") or {}
            return (str(attributes.get("AXSelected", "")).lower() in ("1", "true", "yes")) == expectation.get("selected", True)
        found = _windows_matching(expectation["window"])
        if kind == "windowExists":
            return len(found) > 0
        if kind == "windowGone":
            return len(found) == 0
        if len(found) > 1:
            raise RuntimeError(f"InvalidTarget: verify windowBounds matches {len(found)} windows")
        if not found:
            return False
        box = found[0].get("bounds") or found[0]
        tolerance = expectation.get("tolerance", 0)
        return all(value is None or abs(box[field] - value) <= tolerance for field, value in expectation["bounds"].items())

    class _Computer:
        __slots__ = ("clipboard", "control")

        def __init__(self):
            self.clipboard = _Clipboard()
            self.control = _Control()

        def __repr__(self):
            return "<computer>"

        def _method(self, method, args, kwargs):
            return _call([_step(method, args, kwargs)])

        def window(self, *args, **kwargs):
            """Resolve one window by opaque id or by `app`/`title` filter keywords."""
            return _window(self._method("window", args, kwargs))

        def display(self, selector):
            """Resolve one display id, 'active', or 'all' without changing the session default."""
            return _Display(self._method("display", (selector,), {}))

        def focusedWindow(self):
            return _window(self._method("focusedWindow", (), {}))

        def elementAt(self, x, y):
            return _element(self._method("elementAt", (x, y), {}))

        def focusedElement(self):
            return _element(self._method("focusedElement", (), {}))

        def ref(self, ref):
            """Resolve a live accessibility element by its `[ref=eN]` tag."""
            return _element(self._method("ref", (ref,), {}))

        def run(self, code, *, read_only=None, timeout=None):
            """Run a JavaScript function body in the persistent desktop session and return its value."""
            if not isinstance(code, str):
                raise TypeError("computer.run() expects a JavaScript code string")
            options = {"read_only": read_only, "timeout": timeout}
            return _invoke({"action": "run", "code": code, **{k: v for k, v in options.items() if v is not None}})

        def verify(self, expectation, *, timeoutMs=2000, intervalMs=100):
            """Poll read calls until `expectation` holds or the deadline passes; never sends input."""
            if not isinstance(expectation, dict) or expectation.get("kind") not in _EXPECTATION_KINDS:
                raise TypeError("computer.verify() expects an expectation whose kind is one of " + ", ".join(_EXPECTATION_KINDS))
            if not isinstance(timeoutMs, (int, float)) or timeoutMs != timeoutMs or timeoutMs < 0 or timeoutMs == float("inf"):
                raise TypeError("computer.verify() timeoutMs must be a finite, non-negative number")
            if not isinstance(intervalMs, (int, float)) or intervalMs != intervalMs or intervalMs < 0 or intervalMs == float("inf"):
                raise TypeError("computer.verify() intervalMs must be a finite, non-negative number")
            interval = max(intervalMs, 10) / 1000
            started = time.monotonic()
            deadline = started + timeoutMs / 1000
            reads = 0
            while True:
                reads += 1
                try:
                    satisfied = _holds(expectation)
                except Exception as error:
                    return {"status": "unknown", "reads": reads, "elapsedMs": _elapsed(started), "cause": str(error)}
                now = time.monotonic()
                if satisfied:
                    return {"status": "satisfied", "reads": reads, "elapsedMs": _elapsed(started)}
                if now >= deadline:
                    return {"status": "unsatisfied", "reads": reads, "elapsedMs": _elapsed(started)}
                time.sleep(min(interval, deadline - now))

        def capabilities(self):
            """Native backend capabilities, permission state, stop path, and focus guard."""
            return _invoke({"action": "capabilities"})

        def close(self):
            """End the persistent desktop session; later calls fail."""
            _invoke({"action": "close"})

    _install(_Computer, {name: name for name in _DESKTOP_METHODS})
    return _Computer()


computer = _make_computer()
del _make_computer
