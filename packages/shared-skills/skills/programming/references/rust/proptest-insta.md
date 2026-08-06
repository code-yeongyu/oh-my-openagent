# Property Tests (proptest) + Snapshot Tests (insta)

Two test types every Rust project should have alongside unit tests. Proptest hunts for inputs your unit tests forgot to try. Insta locks down output shapes you do not want to silently change.

## When to reach for each

| Want to test… | Use |
|---|---|
| One specific behavior with a known input | `#[test]` + `assert_eq!` |
| All inputs of a certain shape work | `proptest!` |
| Output structure stays stable across refactors | `insta::assert_*_snapshot!` |
| Parser/serializer round-trips | `proptest!` (the round-trip property) |
| CLI help text, JSON response shape, debug output | `insta::assert_snapshot!` |
| Concurrency under all interleavings | `loom` (see `concurrency.md`) |

Use all three. They cover different bug classes.

## Proptest — setup

`Cargo.toml`:

```toml
[dev-dependencies]
proptest = "1"
proptest-derive = "0.5"     # for #[derive(Arbitrary)]
```

`proptest.toml` at project root (optional, sane defaults):

```toml
cases = 256                  # number of random inputs per property
max_local_rejects = 65536
max_global_rejects = 1024
max_shrink_iters = 1024
max_shrink_time = 60_000      # ms
failure_persistence = { source_file = "proptest-regressions/", file_name = "regressions.txt" }
verbose = 0
```

`failure_persistence` is the killer feature: every failure is written to a regression file. On the next run, those exact inputs are replayed first, so once a bug is found it never escapes again.

## Basic property test

```rust
use proptest::prelude::*;

fn parse(s: &str) -> Result<Color, ParseError> { /* ... */ }
fn render(c: &Color) -> String { /* ... */ }

proptest! {
    #[test]
    fn parse_render_roundtrips(red in 0u8..=255, green in 0u8..=255, blue in 0u8..=255) {
        let color = Color { red, green, blue };
        let rendered = render(&color);
        let parsed = parse(&rendered).expect("our render should always parse");
        prop_assert_eq!(parsed, color);
    }
}
```

`proptest!` macro takes `(arg in strategy, ...)` pairs. Each strategy produces values; proptest runs the body with random samples, then shrinks failing cases to minimal forms.

## Strategies — the value-generation language

| Strategy | Produces |
|---|---|
| `any::<T>()` | Any value of `T` (if `T: Arbitrary`) |
| `0u32..100` | Integer ranges |
| `prop::sample::select(slice)` | Pick from a list |
| `prop::collection::vec(elem, range)` | Vec of length in range |
| `prop::collection::hash_map(k, v, n..m)` | HashMap |
| `prop::option::of(strategy)` | Option |
| `prop::result::maybe_ok(ok, err)` | Result |
| `(s1, s2).prop_map(\|(a, b)\| ...)` | Combine, transform |
| `s.prop_filter("reason", \|v\| pred)` | Reject values |
| `s.prop_flat_map(\|v\| dependent)` | Sequential dependency |
| `prop_oneof![strategy1, strategy2]` | Union of strategies |
| `r"[a-z]{3,10}"` | Regex-generated string |
| `"\\PC*"` | Any printable non-control string |

Example combining several:

```rust
fn config_strategy() -> impl Strategy<Value = Config> {
    (
        prop::sample::select(vec!["dev", "staging", "prod"]),
        0u16..=65535,
        prop::collection::hash_map(
            r"[a-z_]{1,20}",
            any::<String>(),
            0..5,
        ),
    ).prop_map(|(env, port, vars)| Config {
        env: env.into(),
        port,
        env_vars: vars,
    })
}

proptest! {
    #[test]
    fn config_validates(cfg in config_strategy()) {
        let result = validate(&cfg);
        if cfg.port == 0 {
            prop_assert!(result.is_err());
        } else {
            prop_assert!(result.is_ok());
        }
    }
}
```

## Properties to write for every parser

1. **Round-trip:** `parse(render(x)) == x` for all valid `x`.
2. **No-panic:** `parse(arbitrary_string)` never panics, always returns `Result`.
3. **Idempotent:** `parse(parse(x).unwrap().render()) == parse(x).unwrap()`.
4. **Whitespace insensitivity:** `parse(x) == parse(strip_whitespace(x))` (if applicable).

For every serializer:

1. **Length bound:** `render(x).len() <= bound(x)`.
2. **Charset:** `render(x).chars().all(|c| ALLOWED.contains(&c))`.

For every collection operation:

1. **Identity:** `op_identity(x) == x` (sort an already-sorted, dedupe a unique).
2. **Idempotence:** `op(op(x)) == op(x)`.
3. **Commutativity:** `op(a, b) == op(b, a)` (set union, etc).
4. **Length:** `op(a, b).len() == known_relation(a.len(), b.len())`.

For every numeric op:

1. **Monotonicity:** `a <= b => f(a) <= f(b)`.
2. **Identity element:** `f(x, identity) == x`.

Write these mechanically. The agent should reach for proptest the moment any of these properties is checkable.

## Derive `Arbitrary`

```rust
use proptest_derive::Arbitrary;

#[derive(Debug, Clone, PartialEq, Arbitrary)]
struct Vec3 {
    #[proptest(strategy = "-100.0..=100.0")]
    x: f32,
    #[proptest(strategy = "-100.0..=100.0")]
    y: f32,
    #[proptest(strategy = "-100.0..=100.0")]
    z: f32,
}

proptest! {
    #[test]
    fn dot_product_is_commutative(a: Vec3, b: Vec3) {
        prop_assert!((dot(&a, &b) - dot(&b, &a)).abs() < 1e-5);
    }
}
```

`#[derive(Arbitrary)]` auto-implements the strategy. Per-field `#[proptest(strategy = "...")]` overrides.

## Stateful / state machine tests

For data structures with operations (queues, maps, trees), use `proptest-state-machine`:

```rust
use proptest_state_machine::{ReferenceStateMachine, StateMachineTest};

struct MyQueueRef { state: VecDeque<i32> }
struct MyQueueSut { sut: MyQueue<i32> }

#[derive(Debug, Clone)]
enum Op { Push(i32), Pop }

impl ReferenceStateMachine for MyQueueRef {
    type State = VecDeque<i32>;
    type Transition = Op;

    fn init_state() -> BoxedStrategy<Self::State> {
        Just(VecDeque::new()).boxed()
    }
    fn transitions(_: &Self::State) -> BoxedStrategy<Self::Transition> {
        prop_oneof![
            any::<i32>().prop_map(Op::Push),
            Just(Op::Pop),
        ].boxed()
    }
    fn apply(mut state: Self::State, transition: &Self::Transition) -> Self::State {
        match transition {
            Op::Push(x) => state.push_back(*x),
            Op::Pop => { state.pop_front(); }
        }
        state
    }
}

impl StateMachineTest for MyQueueSut {
    type SystemUnderTest = MyQueue<i32>;
    type Reference = MyQueueRef;

    fn init_test(_: &<Self::Reference as ReferenceStateMachine>::State) -> Self::SystemUnderTest {
        MyQueue::new()
    }
    fn apply(mut sut: Self::SystemUnderTest, _: &VecDeque<i32>, transition: Op) -> Self::SystemUnderTest {
        match transition {
            Op::Push(x) => sut.push(x),
            Op::Pop => { sut.pop(); }
        }
        sut
    }
    fn check_invariants(sut: &Self::SystemUnderTest, state: &VecDeque<i32>) {
        assert_eq!(sut.len(), state.len());
        // also check head/tail/iteration order...
    }
}

proptest_state_machine::prop_state_machine! {
    #[test]
    fn queue_matches_vecdeque(sequential 1..50 => MyQueueSut);
}
```

You define a reference implementation (`VecDeque` here), proptest fuzzes operations against both, asserts invariants every step. This is the technique for finding bugs in lock-free or complex containers.

## Shrinking

When a property fails, proptest reduces the input to a minimal counter-example. For built-in strategies this is automatic. For custom strategies built with `prop_map`, shrinking goes through the underlying strategy. Avoid breaking shrinking with `prop_filter` (rejection sampling) over wide spaces; prefer `prop_flat_map` or directly-shaped strategies.

## Regression corpus

When a property test fails, proptest writes the failing input to `proptest-regressions/<test_name>.txt`. Commit this directory. Future runs replay these failing inputs first, so the bug stays fixed forever.

```
proptest-regressions/
└── parse_color.txt   # commit this
```

## Insta — setup

`Cargo.toml`:

```toml
[dev-dependencies]
insta = { version = "1", features = ["yaml", "json", "redactions", "filters"] }

[dependencies.serde_yaml]
version = "0.9"
optional = true
```

Install the CLI:

```bash
cargo install cargo-insta
```

## Insta — basic snapshots

```rust
#[test]
fn renders_default_help() {
    let output = render_help();
    insta::assert_snapshot!(output);
}
```

First run: creates `src/snapshots/mycrate__renders_default_help.snap.new`. Run `cargo insta review`, press `a` to accept, the `.new` extension is dropped. Subsequent runs diff against the committed snapshot; mismatches fail the test.

## Insta — typed snapshots

```rust
#[derive(Debug, serde::Serialize)]
struct Result {
    status: String,
    user: User,
    duration_ms: u64,
}

#[test]
fn json_response() {
    let value = compute();
    insta::assert_json_snapshot!(value);
}

#[test]
fn yaml_response() {
    insta::assert_yaml_snapshot!(value);
}

#[test]
fn debug_repr() {
    insta::assert_debug_snapshot!(value);
}
```

Choose:
- `assert_snapshot!` for `String`/`Display` output (CLI help, error messages, generated code).
- `assert_debug_snapshot!` for `{:?}` (Rust-internal data).
- `assert_json_snapshot!` for structured data crossing process boundaries.
- `assert_yaml_snapshot!` when YAML is easier to read in diffs.

## Insta — redactions and filters

For values that change every run (timestamps, UUIDs, paths):

```rust
#[test]
fn with_redactions() {
    let value = ApiResponse {
        id: uuid::Uuid::now_v7(),
        created_at: jiff::Timestamp::now(),
        body: "hello".into(),
    };
    insta::assert_json_snapshot!(value, {
        ".id" => "[uuid]",
        ".created_at" => "[timestamp]",
    });
}
```

For regex filters applied to all snapshots in a test:

```rust
#[test]
fn with_filters() {
    let mut settings = insta::Settings::clone_current();
    settings.add_filter(r"/tmp/[a-z0-9-]+", "[TMP]");
    settings.add_filter(r"\d+\.\d+ms", "[TIMING]");
    settings.bind(|| {
        let output = run_command();
        insta::assert_snapshot!(output);
    });
}
```

`Settings::bind` scopes filters to the closure.

## Insta workflow

1. Write the test, run it. First run creates `.snap.new`.
2. `cargo insta review` → interactive UI. Show diff, accept/reject.
3. Accepted snapshots commit to the repo.
4. Refactor code. Tests run; mismatches show as diffs.
5. If the new output is correct, `cargo insta accept` (or selective `review`). If wrong, fix the code.

Pair with CI to fail builds when uncommitted `.snap.new` files exist:

```bash
cargo nextest run
if find . -name "*.snap.new" | grep -q .; then
    echo "Pending snapshots, run 'cargo insta review'"
    exit 1
fi
```

## Inline snapshots

```rust
#[test]
fn small_output() {
    let value = compute();
    insta::assert_snapshot!(value, @"hello world");
}
```

The trailing `@"..."` string is the expected snapshot, stored in source. Useful when the value is short enough that pulling out a separate file is overkill. `cargo insta accept` updates them in-place.

## Inline JSON snapshots

```rust
#[test]
fn json_inline() {
    insta::assert_json_snapshot!(value, @r###"
    {
      "status": "ok",
      "count": 3
    }
    "###);
}
```

## Anti-patterns

1. **Snapshots of unstable output.** If `HashMap` iteration order changes per run, snapshots will fail. Switch to `BTreeMap` or sort before snapshotting.
2. **Massive snapshots.** A 10KB JSON dump where you really care about 3 fields. Either narrow to the fields, or accept that any refactor will require re-reviewing 10KB.
3. **Snapshots that bake in implementation details.** "function called 3 times" is not a snapshot - it's a behavior assertion. Use a real assertion.
4. **Skipping `cargo insta review`.** Accepting blind via `cargo insta accept --all` defeats the purpose. Always review.

## Combining proptest + insta

```rust
proptest! {
    #[test]
    fn random_inputs_render_consistently(input: ValidInput) {
        let mut settings = insta::Settings::clone_current();
        settings.set_snapshot_suffix(format!("{}", input.hash()));
        settings.bind(|| {
            insta::assert_snapshot!(render(&input));
        });
    }
}
```

But honestly, this is rarely a fit. Proptest tests properties, insta tests output shape. Don't snapshot random inputs - that defeats both tools.

## CI matrix recommendation

```yaml
- name: Tests
  run: cargo nextest run --all-features

- name: Property regressions (replay)
  run: |
    # The regression files in proptest-regressions/ replay first.
    # Failures here mean a previously-fixed bug came back.
    cargo nextest run --all-features --test-threads 1
```

When a proptest finds a new failure, the regression file appears as a git diff - check it in.

## What proptest cannot do

- Find bugs that require multi-process / multi-network coordination → integration tests + fault injection.
- Find concurrency bugs → use `loom` (see `concurrency.md`).
- Find performance regressions → use `criterion`.

But for any function with a domain (inputs to outputs), proptest can find more bugs than your unit tests. **Write the property first, derive the unit test second.**
