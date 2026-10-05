# Eval-kernel `computer` global: sugar over the ordinary registered tool call `tool.computer(...)`.
# senpi's Python kernel is synchronous, so every helper returns its value directly.
def _make_computer():
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
        result = tool.computer(**arguments)
        if result.get("hasError"):
            raise RuntimeError(result["text"])
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

    _install(
        _Element,
        {name: name for name in ("value", "setValue", "bounds", "attributes", "actions", "perform", "press", "click", "focus")},
    )

    class _Window:
        __slots__ = ("id", "app", "title", "pid", "bounds", "focused")

        def __init__(self, snapshot):
            for field in self.__slots__:
                setattr(self, field, snapshot.get(field))

        def __repr__(self):
            return f"<computer.Window id={self.id!r} app={self.app!r}>"

        def _method(self, method, args, kwargs):
            return _call([_step("window", (self.id,), {}), _step(method, args, kwargs)])

        def find(self, *args, **kwargs):
            return [_Element(snapshot) for snapshot in self._method("find", args, kwargs)]

        def ref(self, ref):
            """Resolve a live accessibility element by its `[ref=eN]` tag."""
            return _element(_call([_step("ref", (ref,), {})]))

    _install(
        _Window,
        {
            **{name: name for name in ("screenshot", "click", "doubleClick", "move", "drag", "scroll", "type", "press", "ax")},
            "raise_": "raise",
        },
    )

    class _Clipboard:
        __slots__ = ()

        def __repr__(self):
            return "<computer.clipboard>"

        def read(self):
            return _call([_step("clipboard.read", (), {})])

        def write(self, text):
            return _call([_step("clipboard.write", (text,), {})])

    class _Computer:
        __slots__ = ("clipboard",)

        def __init__(self):
            self.clipboard = _Clipboard()

        def __repr__(self):
            return "<computer>"

        def _method(self, method, args, kwargs):
            return _call([_step(method, args, kwargs)])

        def window(self, *args, **kwargs):
            """Resolve one window by opaque id or by `app`/`title` filter keywords."""
            return _window(self._method("window", args, kwargs))

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

        def capabilities(self):
            """Native backend capabilities, permission state, stop path, and focus guard."""
            return _invoke({"action": "capabilities"})

        def close(self):
            """End the persistent desktop session; later calls fail."""
            _invoke({"action": "close"})

    _install(
        _Computer,
        {name: name for name in ("displays", "windows", "screenshot", "click", "doubleClick", "move", "drag", "scroll", "type", "press")},
    )
    return _Computer()


computer = _make_computer()
del _make_computer
