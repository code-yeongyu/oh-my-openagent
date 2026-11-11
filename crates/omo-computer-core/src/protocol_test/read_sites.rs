//! Finds the reader call sites in the reader sources: every struct pattern a reader function
//! destructures, the fields it names and whether each bound value is used in that function.
//! The field names come from the patterns themselves, and rustc rejects a pattern that does
//! not name every field of its type exactly (no `..` is accepted here), so this list cannot
//! drift from the types.

use std::collections::{BTreeMap, BTreeSet};

use syn::visit::Visit;
use syn::{ExprPath, ItemFn, Member, Pat, PatStruct, PatTupleStruct};

/// One field a reader's pattern names.
#[derive(Debug, Clone)]
pub(super) struct Site {
    pub ty: String,
    pub field: String,
    pub function: String,
    pub file: String,
    /// The value reaches the reader's output: it is bound and the binding is used, or it is
    /// matched by a nested pattern or a literal.
    pub read: bool,
    pub why_unread: String,
}

/// One struct or tuple-struct pattern: its type, its named fields and whether it has `..`.
struct Pattern {
    ty: String,
    fields: Vec<(String, Pat)>,
    rest: bool,
}

/// The struct patterns of one function and the plain identifiers its expressions use.
#[derive(Default)]
struct FunctionWalk {
    patterns: Vec<Pattern>,
    used: BTreeSet<String>,
}

fn owner_type(path: &syn::Path) -> String {
    let segments: Vec<String> = path
        .segments
        .iter()
        .map(|segment| segment.ident.to_string())
        .collect();
    if segments.len() >= 2 {
        segments[segments.len() - 2].clone()
    } else {
        segments.last().cloned().unwrap_or_default()
    }
}

impl<'ast> Visit<'ast> for FunctionWalk {
    fn visit_pat_struct(&mut self, pattern: &'ast PatStruct) {
        let fields = pattern
            .fields
            .iter()
            .map(|field| (member_name(&field.member), (*field.pat).clone()))
            .collect();
        self.patterns.push(Pattern {
            ty: owner_type(&pattern.path),
            fields,
            rest: pattern.rest.is_some(),
        });
        syn::visit::visit_pat_struct(self, pattern);
    }

    fn visit_pat_tuple_struct(&mut self, pattern: &'ast PatTupleStruct) {
        let fields = pattern
            .elems
            .iter()
            .enumerate()
            .map(|(index, pat)| (index.to_string(), pat.clone()))
            .collect();
        self.patterns.push(Pattern {
            ty: owner_type(&pattern.path),
            fields,
            rest: false,
        });
        syn::visit::visit_pat_tuple_struct(self, pattern);
    }

    fn visit_expr_path(&mut self, path: &'ast ExprPath) {
        if let Some(ident) = path.path.get_ident() {
            self.used.insert(ident.to_string());
        }
        syn::visit::visit_expr_path(self, path);
    }
}

fn judge(pat: &Pat, used: &BTreeSet<String>, rest: bool) -> (bool, String) {
    if rest {
        return (false, "the pattern uses `..`".to_owned());
    }
    match pat {
        Pat::Ident(binding) => {
            let name = binding.ident.to_string();
            if used.contains(&name) {
                (true, String::new())
            } else {
                (false, format!("bound to `{name}` but never used"))
            }
        }
        Pat::Wild(_) => (false, "ignored with `_`".to_owned()),
        nested => nested_unread(nested, used).map_or((true, String::new()), |why| {
            (false, format!("destructured inline: {why}"))
        }),
    }
}

/// A field destructured inline is read only if every leaf binding inside the nested pattern
/// is used and no `_` or `..` drops part of it; the nested type being read elsewhere does not
/// count. Literal leaves are matched, so they read. Returns why the pattern drops a value.
fn nested_unread(pat: &Pat, used: &BTreeSet<String>) -> Option<String> {
    match pat {
        Pat::Ident(binding) => {
            let name = binding.ident.to_string();
            if !used.contains(&name) {
                return Some(format!("`{name}` is bound but never used"));
            }
            binding
                .subpat
                .as_ref()
                .and_then(|(_, inner)| nested_unread(inner, used))
        }
        Pat::Wild(_) => Some("a value is ignored with `_`".to_owned()),
        Pat::Rest(_) => Some("the pattern uses `..`".to_owned()),
        Pat::Struct(inner) => {
            if inner.rest.is_some() {
                return Some("the pattern uses `..`".to_owned());
            }
            inner.fields.iter().find_map(|field| {
                nested_unread(&field.pat, used)
                    .map(|why| format!("{}: {why}", member_name(&field.member)))
            })
        }
        Pat::TupleStruct(inner) => inner
            .elems
            .iter()
            .find_map(|elem| nested_unread(elem, used)),
        Pat::Tuple(inner) => inner
            .elems
            .iter()
            .find_map(|elem| nested_unread(elem, used)),
        Pat::Slice(inner) => inner
            .elems
            .iter()
            .find_map(|elem| nested_unread(elem, used)),
        Pat::Or(inner) => inner
            .cases
            .iter()
            .find_map(|case| nested_unread(case, used)),
        Pat::Paren(inner) => nested_unread(&inner.pat, used),
        Pat::Reference(inner) => nested_unread(&inner.pat, used),
        Pat::Type(inner) => nested_unread(&inner.pat, used),
        _ => None,
    }
}

fn member_name(member: &Member) -> String {
    match member {
        Member::Named(ident) => ident.to_string(),
        Member::Unnamed(index) => index.index.to_string(),
    }
}

fn walk_function(function: &ItemFn, file: &str, sites: &mut Vec<Site>) {
    let mut walk = FunctionWalk::default();
    walk.visit_item_fn(function);
    for Pattern { ty, fields, rest } in &walk.patterns {
        for (field, pat) in fields {
            let (read, why_unread) = judge(pat, &walk.used, *rest);
            sites.push(Site {
                ty: ty.clone(),
                field: field.clone(),
                function: function.sig.ident.to_string(),
                file: file.to_owned(),
                read,
                why_unread,
            });
        }
    }
}

fn rust_files(directory: &std::path::Path, found: &mut Vec<std::path::PathBuf>) {
    for path in std::fs::read_dir(directory)
        .expect("reader sources")
        .flatten()
        .map(|entry| entry.path())
    {
        if path.is_dir() {
            rust_files(&path, found);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            found.push(path);
        }
    }
}

/// Every field site of every reader function under `directory`, subdirectories included.
pub(super) fn reader_sites(directory: &std::path::Path) -> Vec<Site> {
    let mut paths = Vec::new();
    rust_files(directory, &mut paths);
    paths.sort();
    let mut sites = Vec::new();
    for path in paths {
        let source = std::fs::read_to_string(&path).expect("read reader source");
        let parsed = syn::parse_file(&source).expect("reader source parses");
        let file = path
            .strip_prefix(directory)
            .unwrap_or(&path)
            .to_string_lossy()
            .into_owned();
        for item in &parsed.items {
            if let syn::Item::Fn(function) = item {
                walk_function(function, &file, &mut sites);
            }
        }
    }
    sites
}

/// `type -> wire member -> sites`, the wire name being the serde name of the Rust field.
pub(super) fn sites_by_member(
    sites: &[Site],
    wire_name: impl Fn(&str, &str) -> String,
) -> BTreeMap<String, BTreeMap<String, Vec<Site>>> {
    let mut map: BTreeMap<String, BTreeMap<String, Vec<Site>>> = BTreeMap::new();
    for site in sites {
        map.entry(site.ty.clone())
            .or_default()
            .entry(wire_name(&site.ty, &site.field))
            .or_default()
            .push(site.clone());
    }
    map
}
