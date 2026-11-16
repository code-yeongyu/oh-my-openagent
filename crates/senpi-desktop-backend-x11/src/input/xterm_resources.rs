//! xterm's `allowSendEvents` for one client, matched the way Xrm matches a
//! resource: each entry's components are checked against the client's own
//! name and class path (`<instance>.vt100.allowSendEvents`,
//! `<Class>.VT100.AllowSendEvents`), with `.` binding tightly and `*`
//! loosely, so an entry for another application or another widget never
//! applies. Instead of Xrm's precedence, the check is conservative: it
//! accepts only when at least one entry matches and every matching entry
//! says true, so the answer can be wrong only toward refusing. A build with
//! xterm's toolbar puts vt100 under a `form` widget, so both paths must agree.

/// The widget levels between the shell and the resource, as `(name, class)`.
const WIDGET_PATHS: [&[(&str, &str)]; 2] = [&[("vt100", "VT100")], &[("form", "Form"), ("vt100", "VT100")]];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Binding {
    Tight,
    Loose,
}

struct Entry {
    components: Vec<(Binding, String)>,
    value: bool,
}

/// Whether xterm with `WM_CLASS` `instance`/`class` has `allowSendEvents`
/// on, from its `-xrm` arguments and the `RESOURCE_MANAGER` `database`.
pub fn allows_send_events(instance: &str, class: &str, args: &[String], database: &[u8]) -> bool {
    let database = String::from_utf8_lossy(database);
    let from_args = args
        .windows(2)
        .filter(|pair| pair[0] == "-xrm")
        .map(|pair| pair[1].as_str());
    let entries: Vec<Entry> = database.lines().chain(from_args).filter_map(parse).collect();
    WIDGET_PATHS.iter().all(|widgets| {
        let mut names = vec![instance];
        let mut classes = vec![class];
        for &(name, widget_class) in *widgets {
            names.push(name);
            classes.push(widget_class);
        }
        names.push("allowSendEvents");
        classes.push("AllowSendEvents");
        let mut values = entries
            .iter()
            .filter(|entry| matches(&entry.components, &names, &classes))
            .map(|entry| entry.value)
            .peekable();
        values.peek().is_some() && values.all(|value| value)
    })
}

/// One `key: value` line whose last component is `allowSendEvents`;
/// comments and other resources are `None`.
fn parse(line: &str) -> Option<Entry> {
    let line = line.trim_start();
    if line.starts_with('!') || line.starts_with('#') {
        return None;
    }
    let (key, value) = line.split_once(':')?;
    let components = components(key.trim());
    let (_, last) = components.last()?;
    if last != "allowSendEvents" && last != "AllowSendEvents" {
        return None;
    }
    let value = matches!(value.trim().to_ascii_lowercase().as_str(), "true" | "on" | "yes");
    Some(Entry { components, value })
}

/// `XTerm*vt100.allowSendEvents` as `[(Tight, XTerm), (Loose, vt100),
/// (Tight, allowSendEvents)]`; a run of separators binds loosely if it holds
/// a `*`.
fn components(key: &str) -> Vec<(Binding, String)> {
    let mut components = Vec::new();
    let mut binding = Binding::Tight;
    let mut current = String::new();
    for ch in key.chars() {
        match ch {
            '.' | '*' => {
                if !current.is_empty() {
                    components.push((binding, std::mem::take(&mut current)));
                    binding = Binding::Tight;
                }
                if ch == '*' {
                    binding = Binding::Loose;
                }
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() {
        components.push((binding, current));
    }
    components
}

/// Whether `components` match the whole level path: a tight component
/// matches the next level, a loose one may first skip any number of levels;
/// a component matches a level by its name, its class, or `?`.
fn matches(components: &[(Binding, String)], names: &[&str], classes: &[&str]) -> bool {
    let Some(((binding, component), rest)) = components.split_first() else {
        return names.is_empty();
    };
    let skippable = if *binding == Binding::Loose { names.len() } else { 1.min(names.len()) };
    (0..skippable).any(|level| {
        let hit = component == "?" || component == names[level] || component == classes[level];
        hit && matches(rest, &names[level + 1..], &classes[level + 1..])
    })
}
