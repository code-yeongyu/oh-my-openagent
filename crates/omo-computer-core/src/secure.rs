//! Secure classification and read-side withholding (row 26; acceptance 17 and 62; design
//! d-a11y-model.md 'Redaction'). A node is secure when the backend marked it (macOS subrole
//! `AXSecureTextField`, UIA `IsPassword`, AT-SPI `password text`), or when its label carries one
//! of the label words. A secure node's value is never read into a reply.

use crate::ax::NodeRead;

const NATIVE_SECURE_ROLES: [&str; 3] = ["AXSecureTextField", "PasswordText", "password text"];

/// Acceptance 17: the one label rule, `password|passcode|otp|cvv|ssn` as whole words, any case.
const LABEL_WORDS: [&str; 5] = ["password", "passcode", "otp", "cvv", "ssn"];

#[must_use]
pub fn label_marks_secure(label: &str) -> bool {
    label
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .any(|word| LABEL_WORDS.iter().any(|secret| word.eq_ignore_ascii_case(secret)))
}

#[must_use]
pub fn is_secure(node: &NodeRead) -> bool {
    node.secure
        || node.native_role.as_deref().is_some_and(|role| NATIVE_SECURE_ROLES.contains(&role))
        || node.stable_text().is_some_and(label_marks_secure)
}

/// Marks `node` secure and drops its value when it is a secure field; any other node is unchanged.
pub fn withhold(node: &mut NodeRead) {
    if is_secure(node) {
        node.secure = true;
        node.value = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field(native_role: Option<&str>, title: &str, value: &str) -> NodeRead {
        NodeRead {
            role: "textfield".to_owned(),
            native_role: native_role.map(str::to_owned),
            title: Some(title.to_owned()),
            value: Some(value.to_owned()),
            ..NodeRead::default()
        }
    }

    #[test]
    fn secure_field_value_is_withheld() {
        for mut node in [
            field(Some("AXSecureTextField"), "Account", "hunter2"),
            field(Some("PasswordText"), "Account", "hunter2"),
            field(None, "One-time OTP code", "123456"),
            field(None, "CVV", "999"),
        ] {
            withhold(&mut node);
            assert!(node.secure, "{node:?}");
            assert_eq!(node.value, None, "the value never reaches a reply: {node:?}");
        }
        let mut plain = field(None, "Search", "cats");
        withhold(&mut plain);
        assert_eq!((plain.secure, plain.value.as_deref()), (false, Some("cats")), "an ordinary field keeps its value");
    }

    #[test]
    fn the_label_rule_matches_whole_words_only() {
        for label in ["Password", "Enter passcode", "SSN:", "otp", "card-cvv"] {
            assert!(label_marks_secure(label), "{label}");
        }
        for label in ["Passwords manager docs", "cotpanel", "Search"] {
            assert!(!label_marks_secure(label), "{label}");
        }
    }
}
