# Type-State and Newtype Patterns

The single highest-leverage thing Rust gives a coding agent: encode invariants in the type system so the compiler refuses incorrect code. The agent does not have to "remember" rules - the rules are physical.

## The Two Core Patterns

1. **Newtype wrappers for distinct semantic units.** Money, IDs, byte offsets, coordinate spaces - each gets its own tuple struct. The agent cannot pass meters where feet are expected, even though both are `f64` under the hood. This is the `euclid::Point<Screen>` vs `euclid::Point<World>` example Chris Allen called out.
2. **Type-state for state machines.** Instead of a struct with a `status: enum { Draft, Validated, Persisted }` field and methods that check `if self.status == ...`, model each state as its own type. Transitions are method calls that consume `self` and return a new type. Illegal transitions become unrepresentable.

## Newtype Wrapper Cookbook

### Domain IDs

```rust
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct UserId(Uuid);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
pub struct ProductId(Uuid);

impl UserId {
    pub fn new() -> Self { Self(Uuid::now_v7()) }
    pub fn as_uuid(&self) -> &Uuid { &self.0 }
}

impl ProductId {
    pub fn new() -> Self { Self(Uuid::now_v7()) }
    pub fn as_uuid(&self) -> &Uuid { &self.0 }
}

// `fn buy(user: UserId, product: ProductId)` cannot be called with arguments swapped.
```

`#[serde(transparent)]` keeps JSON/SQL round-trips identical to a bare `Uuid` - the wrapper is purely a compile-time discipline.

### Quantities with Phantom Type Tags

```rust
use core::marker::PhantomData;
use core::ops::{Add, Sub, Mul};

#[derive(Debug, Clone, Copy)]
pub struct Quantity<Unit> {
    raw: f64,
    _unit: PhantomData<Unit>,
}

// Tag types - zero-sized, never instantiated.
pub struct Meters;
pub struct Feet;
pub struct Seconds;

impl<U> Quantity<U> {
    pub const fn new(value: f64) -> Self {
        Self { raw: value, _unit: PhantomData }
    }
    pub fn raw(self) -> f64 { self.raw }
}

// Adding same-unit quantities: allowed.
impl<U> Add for Quantity<U> {
    type Output = Self;
    fn add(self, rhs: Self) -> Self { Self::new(self.raw + rhs.raw) }
}

// Subtraction: allowed.
impl<U> Sub for Quantity<U> {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self { Self::new(self.raw - rhs.raw) }
}

// Multiplying by scalar: allowed.
impl<U> Mul<f64> for Quantity<U> {
    type Output = Self;
    fn mul(self, rhs: f64) -> Self { Self::new(self.raw * rhs) }
}

// Conversions are explicit, named methods - never `From`/`Into` between units.
impl Quantity<Meters> {
    pub fn to_feet(self) -> Quantity<Feet> {
        Quantity::new(self.raw * 3.280_84)
    }
}
```

Now:

```rust
let distance: Quantity<Meters> = Quantity::new(100.0);
let height: Quantity<Feet> = Quantity::new(50.0);
let combined = distance + height; // ❌ compile error
let combined = distance + height.to_feet().to_meters_oops(); // ❌ no such method
let combined = distance + distance; // ✅
```

The agent cannot accidentally mix units. Refactors that change a quantity's underlying unit are caught at compile time everywhere the type flows.

### Byte Offsets vs Character Offsets

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ByteOffset(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct CharOffset(pub u32);

impl ByteOffset {
    pub fn add(self, delta: u32) -> Self { Self(self.0 + delta) }
}

// Converting between them is a function on the actual text.
pub fn byte_to_char(text: &str, byte: ByteOffset) -> Option<CharOffset> {
    text.get(..byte.0 as usize).map(|prefix| CharOffset(prefix.chars().count() as u32))
}
```

A function signature `fn slice(text: &str, start: ByteOffset, end: ByteOffset)` cannot be called with character offsets. The UTF-8 boundary bug is now a compile error.

### Currency

```rust
use rust_decimal::Decimal;

pub struct Krw;
pub struct Usd;
pub struct Jpy;

#[derive(Debug, Clone, Copy)]
pub struct Money<Currency> {
    amount: Decimal,
    _ccy: PhantomData<Currency>,
}

impl<C> Money<C> {
    pub const fn new(amount: Decimal) -> Self { Self { amount, _ccy: PhantomData } }
}

impl<C> Add for Money<C> {
    type Output = Self;
    fn add(self, rhs: Self) -> Self { Self::new(self.amount + rhs.amount) }
}

// No blanket From<Money<X>> for Money<Y> - conversions go through an explicit
// FX rate function that takes a `Rate<From, To>` argument.

pub struct Rate<From, To> {
    factor: Decimal,
    _from: PhantomData<From>,
    _to: PhantomData<To>,
}

impl<From, To> Money<From> {
    pub fn convert(self, rate: Rate<From, To>) -> Money<To> {
        Money::new(self.amount * rate.factor)
    }
}
```

The agent cannot add KRW and USD by accident. They cannot convert without a rate. They cannot apply a USD→JPY rate to a KRW value.

### Paths Rooted at Different Bases

```rust
use std::path::{Path, PathBuf};

/// A path guaranteed to be relative to the project root.
#[derive(Debug, Clone)]
pub struct ProjectRel(PathBuf);

/// A path guaranteed to be relative to the user's home directory.
#[derive(Debug, Clone)]
pub struct HomeRel(PathBuf);

impl ProjectRel {
    pub fn new(path: impl AsRef<Path>) -> Result<Self, PathError> {
        let path = path.as_ref();
        if path.is_absolute() { return Err(PathError::NotRelative); }
        if path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return Err(PathError::EscapesRoot);
        }
        Ok(Self(path.to_path_buf()))
    }

    pub fn resolve(&self, project_root: &Path) -> PathBuf {
        project_root.join(&self.0)
    }
}
```

The agent's path-handling code now distinguishes between project-relative and home-relative paths at the type level. A function taking `ProjectRel` cannot be called with a `HomeRel`.

## Type-State State Machines

Encode the lifecycle of a value as a sequence of types. Each transition consumes the previous state and returns the next.

### HTTP Request Builder

```rust
pub struct RequestBuilder<State> {
    url: String,
    method: Method,
    headers: HeaderMap,
    body: Option<Vec<u8>>,
    _state: PhantomData<State>,
}

pub struct NeedsUrl;
pub struct NeedsMethod;
pub struct Ready;

impl RequestBuilder<NeedsUrl> {
    pub fn new() -> Self {
        Self {
            url: String::new(),
            method: Method::GET,
            headers: HeaderMap::new(),
            body: None,
            _state: PhantomData,
        }
    }
    pub fn url(mut self, url: impl Into<String>) -> RequestBuilder<NeedsMethod> {
        self.url = url.into();
        RequestBuilder { url: self.url, method: self.method, headers: self.headers, body: self.body, _state: PhantomData }
    }
}

impl RequestBuilder<NeedsMethod> {
    pub fn method(mut self, method: Method) -> RequestBuilder<Ready> {
        self.method = method;
        RequestBuilder { url: self.url, method: self.method, headers: self.headers, body: self.body, _state: PhantomData }
    }
}

// .header(), .body() available in any state that has at least URL.
impl<S> RequestBuilder<S> {
    pub fn header(mut self, name: HeaderName, value: HeaderValue) -> Self {
        self.headers.insert(name, value);
        self
    }
}

// .send() only available once URL and method are set.
impl RequestBuilder<Ready> {
    pub async fn send(self, client: &Client) -> reqwest::Result<Response> { /* ... */ }
}
```

`client.send(RequestBuilder::new().send(...))` - compile error. The agent has to fill in the required steps. The IDE autocomplete also reflects only the legal next steps.

### File Handles

```rust
pub struct File<State> {
    fd: RawFd,
    _state: PhantomData<State>,
}

pub struct Open;
pub struct Locked;
pub struct Closed;

impl File<Open> {
    pub fn open(path: &Path) -> std::io::Result<Self> { /* ... */ }
    pub fn lock_exclusive(self) -> std::io::Result<File<Locked>> { /* flock */ }
    pub fn close(self) -> std::io::Result<File<Closed>> { /* ... */ }
}

impl File<Locked> {
    pub fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> { /* ... */ }
    pub fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> { /* ... */ }
    pub fn unlock(self) -> std::io::Result<File<Open>> { /* ... */ }
}

impl File<Closed> {
    // No methods. The type only exists to be dropped.
}
```

You cannot `read()` an unlocked file. You cannot `close()` while holding a lock without unlocking first. You cannot use a closed file at all - it has no methods.

## Sealed Traits

Sometimes you want a closed set of types implementing a trait, defined by the crate, not extensible by downstream. The sealed trait pattern:

```rust
mod sealed {
    pub trait Sealed {}
}

pub trait Renderer: sealed::Sealed {
    fn render(&self, frame: &mut Frame);
}

pub struct OpenGl;
pub struct Vulkan;
pub struct Metal;

impl sealed::Sealed for OpenGl {}
impl sealed::Sealed for Vulkan {}
impl sealed::Sealed for Metal {}

impl Renderer for OpenGl { fn render(&self, f: &mut Frame) { /* ... */ } }
impl Renderer for Vulkan { fn render(&self, f: &mut Frame) { /* ... */ } }
impl Renderer for Metal  { fn render(&self, f: &mut Frame) { /* ... */ } }
```

Downstream code cannot add new `impl Renderer for Whatever` because they cannot implement `sealed::Sealed` (its module is private). Useful when you want trait dispatch but maintain the invariant that you control all implementations.

## NonEmpty Collections

```rust
pub struct NonEmptyVec<T> {
    head: T,
    tail: Vec<T>,
}

#[derive(Debug, thiserror::Error)]
#[error("vector was empty")]
pub struct Empty;

impl<T> NonEmptyVec<T> {
    pub fn try_from_vec(mut v: Vec<T>) -> Result<Self, Empty> {
        if v.is_empty() { return Err(Empty); }
        let tail = v.split_off(1);
        let head = v.into_iter().next().expect("checked non-empty");
        Ok(Self { head, tail })
    }

    pub fn first(&self) -> &T { &self.head }
    pub fn len(&self) -> usize { self.tail.len() + 1 }
}
```

Functions taking `NonEmptyVec<T>` cannot receive an empty vector. The `first()` method returns `&T`, not `Option<&T>`. The agent never has to write `match v.first() { Some(x) => ..., None => panic!(...) }` again.

## When NOT to Newtype

- For one-off internal computations where the unit lives in a single function and never crosses a boundary.
- When the wrapper does not change behavior or invariants vs. the underlying type (e.g., a `struct Count(u32)` that is only ever used in one struct).
- When `From`/`Into` conversions would be ergonomic but would defeat the purpose (if you find yourself wanting `impl From<UserId> for Uuid`, you do not want a newtype - you want a type alias).

The cost of a newtype is one tuple struct + the impls you need. The break-even is around three uses across different functions, or any use that crosses an API boundary.

## When NOT to Use Type-State

- When the state space is small and transitions are simple (`Option<T>` and `Result<T, E>` are state machines already).
- When the type-state would force runtime branching upward (e.g., reading "should this run as Open or Locked?" from config means you store `Box<dyn FileLike>` anyway).
- When the API is consumed by code that does not know the state at compile time (heterogeneous collections, dynamic dispatch boundaries).

In those cases, regular enum-tagged states are correct. The line is: **can the call site know the state statically?** If yes, type-state. If no, enum-with-tag.
