use std::fmt;

/// The parsed facts a row observed. Every row prints it and puts it in its assertion messages, so a failure on
/// CI always carries the receipt (design section 20 rules).
pub struct Receipt {
    title: String,
    lines: Vec<String>,
}

impl Receipt {
    pub fn new(title: impl Into<String>) -> Self {
        Self {
            title: title.into(),
            lines: Vec::new(),
        }
    }

    pub fn line(&mut self, text: impl Into<String>) {
        let text = text.into();
        println!("[{}] {text}", self.title);
        self.lines.push(text);
    }
}

impl fmt::Display for Receipt {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(out, "receipt: {}", self.title)?;
        for line in &self.lines {
            writeln!(out, "  {line}")?;
        }
        Ok(())
    }
}
