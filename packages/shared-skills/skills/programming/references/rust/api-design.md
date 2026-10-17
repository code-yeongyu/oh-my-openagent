# Public API Design

What a caller sees: names, conversions, traits, attributes, visibility, and rustdoc. Every rule here exists so a call site reads correctly without opening the implementation.

## Naming says cost and ownership

| Prefix / form | Meaning | Example |
|---|---|---|
| `as_x(&self) -> &X` | Borrowed view, no allocation | `str::as_bytes`, `PathBuf::as_path` |
| `to_x(&self) -> X` | Builds a new owned value (may allocate or compute) | `str::to_lowercase`, `Path::to_path_buf` |
| `into_x(self) -> X` | Consumes `self`, reuses its buffers | `String::into_bytes`, `Vec::into_boxed_slice` |
| `x(&self)` | Plain accessor, no `get_` prefix | `len()`, `name()`, `user_id()` |
| `get(&self, key)` | Fallible lookup that returns `Option` | `HashMap::get`, `slice::get` |
| `iter()` / `iter_mut()` / `IntoIterator` | Borrowing, mutable, and consuming iteration | implement the ones the type actually needs |
| `is_x()` / `has_x()` / `can_x()` | `bool` query, named for the positive state | `is_empty()`, `has_children()` |

Types, traits, and enum variants are `UpperCamelCase` with acronyms as one word (`HttpClient`, `Json`, not `HTTPClient`); functions, modules, and locals `snake_case`; constants and statics `SCREAMING_SNAKE_CASE`; simple generics `T`, `E`, `K`, `V`, lifetimes short (`'a`, `'de`). Return `impl Iterator<Item = T>` instead of a named iterator struct unless callers need to name the type.

## Conversions

| Conversion | Trait | Rule |
|---|---|---|
| Always succeeds, no invariant can break | `From<T>` | Implement `From`; callers get `Into` for free. Never implement `Into` directly. |
| Can fail | `TryFrom<T>` | `type Error` is a real error type, never `()` or `String`. |
| Parses text | `FromStr` | Routes through the same checked constructor as `TryFrom`. |
| Cheap borrowed view for a generic parameter | `AsRef<T>` | Accept `impl AsRef<Path>` only where callers really pass several types; a plain `&Path` is simpler otherwise. |

Validated types expose `TryFrom` / `FromStr` only; an infallible `From` into them bypasses the invariant ([type-state.md](type-state.md)). Units convert through named methods (`to_feet()`), never `From`, so the conversion is visible.

Generic parameters that only convert (`fn new(name: impl Into<String>)`) hide an allocation at the call site; take `&str` or `String` explicitly unless the constructor is called with both often.

## Trait design

- **Generic by default, `dyn` for heterogeneity.** `fn run<R: Renderer>(r: &R)` monomorphizes and inlines; `&dyn Renderer` or `Box<dyn Renderer>` is for a collection of mixed implementors or a deliberate code-size trade. `dyn` needs indirection, not necessarily a heap allocation: `&dyn Trait` borrows.
- **Associated type vs generic parameter.** One natural output per implementor (`Iterator::Item`, a parser's `Output`) is an associated type. A generic parameter (`From<T>`) is for traits a type implements several times.
- **Minimal required methods.** Require the few methods that carry the contract; provide the rest as default methods built on them. A default method must be correct for every implementor, not merely convenient.
- **Blanket impls are a semver commitment.** A public `impl<T: Display> MyTrait for T` forbids downstream crates, and your own future versions, from writing a more specific impl. Add one only when it is permanently right for every `T`.
- **Orphan rule.** You cannot implement a foreign trait for a foreign type. Wrap the type in a local newtype and implement the trait on the wrapper; do not add `Deref` to the inner type to make it convenient.
- **Closed sets are sealed.** A public trait whose implementations only you may add uses the sealed-trait pattern ([type-state.md](type-state.md#sealed-traits)).
- **Bounds live on impls, not structs.** `struct Cache<K, V> { .. }` stays unbounded; `impl<K: Hash + Eq, V> Cache<K, V>` carries the bounds, so every mention of `Cache` does not repeat them.
- **Callables take the weakest bound.** `FnOnce` if called once, `FnMut` if called repeatedly with mutation, `Fn` for shared repeated calls. Return a closure as `impl Fn(..)`; box it (`Box<dyn Fn(..)>`) only to store closures of different types together.

## Attributes that protect callers

- **`#[must_use]`** on builder methods that return `Self` (a dropped builder silently loses configuration), on pure constructors of values whose drop is a bug, and on functions whose whole point is the return value. `Result` is already `must_use`; do not blanket-annotate every function.
- **`#[non_exhaustive]`** on public enums and structs that will grow (error enums, config structs, event types). Downstream matches get a required `_` arm and your next variant is not a breaking change. Keep a public enum exhaustive only when its closed set is part of the contract (`Ordering`). `exhaustive_enums` / `exhaustive_structs` in [cargo-strict.md](cargo-strict.md) flag the choice.

## Visibility

Start private. Widen one step at a time, only for a caller that exists: private -> `pub(super)` (sibling modules) -> `pub(crate)` -> `pub`. The `unreachable_pub` lint catches `pub` items no one outside the crate can reach. Shape the public surface with deliberate re-exports (`pub use crate::parse::Parser;` in `lib.rs`), never `pub use module::*`, which exports whatever a later edit adds.

## Rustdoc sections

Every public item has a doc comment (`missing_docs`). Public fallible, panicking, or `unsafe` functions carry the section a caller needs:

```rust
/// Parses a `key=value` line.
///
/// # Errors
///
/// Returns [`ParseError::MissingSeparator`] when the line has no `=`.
///
/// # Examples
///
/// ```
/// # use my_crate::{parse_pair, ParseError};
/// # fn main() -> Result<(), ParseError> {
/// let (key, value) = parse_pair("port=8080")?;
/// assert_eq!((key, value), ("port", "8080"));
/// # Ok(())
/// # }
/// ```
pub fn parse_pair(line: &str) -> Result<(&str, &str), ParseError> {
    line.split_once('=').ok_or(ParseError::MissingSeparator)
}
```

- `# Errors` for every public `Result`-returning function (`missing_errors_doc`), `# Panics` for every reachable panic (`missing_panics_doc`), `# Safety` for every public `unsafe fn` or `unsafe trait`, listing each obligation the caller takes on.
- Examples use `?`, never `unwrap`; lines starting with `# ` compile but stay hidden, which is where imports and the `fn main() -> Result` wrapper go.
- Link types with intra-doc links (``[`ParseError`]``). `RUSTDOCFLAGS="-D warnings" cargo doc` fails on a broken link, and `cargo test --doc` runs every example.
- A crate's front page can be its README: `#![doc = include_str!("../README.md")]` makes the README's code blocks doctests too.
