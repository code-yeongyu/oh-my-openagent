# Macros

A macro is the last rung of the ladder: reach for one only when a function, a generic, or a trait cannot express the thing (variadic input, new syntax, generating items, compile-time code from a type's shape). Macros cost compile time, error-message quality, and IDE support.

## `macro_rules!`

```rust
/// Builds a `HashMap` from `key => value` pairs.
#[macro_export]
macro_rules! hashmap {
    ($($key:expr => $value:expr),* $(,)?) => {{
        let mut map = $crate::__private::HashMap::new();
        $( map.insert($key, $value); )*
        map
    }};
}

#[doc(hidden)]
pub mod __private {
    pub use std::collections::HashMap;
}
```

- **`$crate::` for every item of the defining crate.** Callers may rename your crate or lack the import; `$crate` always resolves to the crate that defined the macro.
- **Narrowest fragment specifier.** `expr`, `ty`, `ident`, `path`, `pat`, `literal` give callers real error messages and parse precedence correctly; `tt` accepts anything and defers the error to a confusing expansion.
- **Helpers the expansion needs** live in a `#[doc(hidden)] pub mod __private` and are reached through `$crate::__private::...`; they are not API.
- **`#[macro_export]` puts the macro at the crate root** (`my_crate::hashmap!`). Import it by path (`use my_crate::hashmap;`), not `#[macro_use] extern crate`.
- Hygiene covers local variables, not items or method calls: a name the expansion uses unqualified resolves at the call site. Qualify everything.

## Procedural macros

A proc macro lives in its own crate (`[lib] proc-macro = true`), which can export nothing else. Ship it as `my-crate-derive` and re-export it from `my-crate` so users depend on one crate and the macro's generated code can refer to `::my_crate::...`.

```rust
use proc_macro::TokenStream;
use quote::{format_ident, quote};
use syn::{parse_macro_input, Data, DeriveInput};

#[proc_macro_derive(Builder)]
pub fn derive_builder(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    expand(&input).unwrap_or_else(syn::Error::into_compile_error).into()
}

fn expand(input: &DeriveInput) -> syn::Result<proc_macro2::TokenStream> {
    let Data::Struct(_) = &input.data else {
        return Err(syn::Error::new_spanned(&input.ident, "Builder supports structs only"));
    };
    let name = &input.ident;
    let builder = format_ident!("{}Builder", name); // quote! cannot paste identifiers
    Ok(quote! {
        impl #name {
            pub fn builder() -> #builder { #builder::default() }
        }
    })
}
```

- Parse with `syn`, generate with `quote`, work in `proc_macro2` types so the logic is unit-testable outside the compiler.
- **Never panic.** Report problems as `syn::Error::new_spanned(the_offending_tokens, "...")` and return `into_compile_error()`: the compiler underlines the exact input the user must change. A panic produces one message at the derive site with no location.
- Build new identifiers with `format_ident!`; `quote!` has no token pasting (`#name##Builder` is not valid).
- Generated code uses fully qualified paths (`::core::option::Option`, `::my_crate::Trait`) so it compiles regardless of what the caller imported or shadowed.
- Test expansions with `trybuild` (pass and compile-fail cases, including the error message spans) rather than by asserting on generated token text.
