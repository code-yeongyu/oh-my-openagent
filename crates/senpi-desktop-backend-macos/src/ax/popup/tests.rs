use super::fake::{option, FakeOption, FakePopup, IMMEDIATE};
use super::{choose_in, PopupControl};

fn formats() -> Vec<FakeOption> {
    vec![
        option("Rich Text"),
        option(""),
        option("Web Page (.html)"),
        option("Plain Text"),
    ]
}

#[test]
fn the_exactly_titled_option_is_pressed_and_confirmed_by_the_popup_value() {
    let popup = FakePopup::new("Rich Text", &formats());
    choose_in(&popup, "Web Page (.html)", IMMEDIATE).unwrap();
    assert_eq!(popup.value().as_deref(), Some("Web Page (.html)"));
    assert_eq!(popup.performed(), ["AXPress", "press Web Page (.html)"]);
}

#[test]
fn a_menu_still_open_after_the_choice_is_cancelled_before_returning() {
    let popup = FakePopup {
        press_closes_menu: false,
        ..FakePopup::new("Rich Text", &formats())
    };
    choose_in(&popup, "Plain Text", IMMEDIATE).unwrap();
    assert_eq!(popup.performed(), ["AXPress", "press Plain Text", "AXCancel"]);
    assert!(!popup.menu_open());
}

#[test]
fn a_chosen_option_whose_menu_will_not_close_says_both() {
    let popup = FakePopup {
        press_closes_menu: false,
        cancel_closes: false,
        ..FakePopup::new("Rich Text", &formats())
    };
    let error = choose_in(&popup, "Plain Text", IMMEDIATE).unwrap_err();
    assert!(error.message.contains("\"Plain Text\" was chosen"), "{}", error.message);
    assert!(error.message.contains("still open"), "{}", error.message);
    assert_eq!(popup.value().as_deref(), Some("Plain Text"));
}

#[test]
fn a_popup_already_showing_the_value_is_left_untouched() {
    let popup = FakePopup::new("Plain Text", &formats());
    choose_in(&popup, "Plain Text", IMMEDIATE).unwrap();
    assert!(popup.performed().is_empty());
}

#[test]
fn a_disabled_popup_is_refused_without_opening_it() {
    let popup = FakePopup {
        enabled: false,
        ..FakePopup::new("Rich Text", &formats())
    };
    let error = choose_in(&popup, "Plain Text", IMMEDIATE).unwrap_err();
    assert!(error.message.contains("disabled"), "{}", error.message);
    assert!(popup.performed().is_empty());
}

#[test]
fn an_unknown_value_is_refused_listing_the_options_and_the_opened_menu_is_closed() {
    let popup = FakePopup::new("Rich Text", &formats());
    let error = choose_in(&popup, "web page (.html)", IMMEDIATE).unwrap_err();
    assert!(
        error
            .message
            .contains("\"Rich Text\", \"Web Page (.html)\", \"Plain Text\""),
        "{}",
        error.message
    );
    assert_eq!(popup.performed(), ["AXPress", "AXCancel"]);
    assert!(!popup.menu_open());
    assert_eq!(popup.value().as_deref(), Some("Rich Text"));
}

#[test]
fn a_shared_title_is_refused_and_the_opened_menu_is_closed() {
    let popup = FakePopup::new("None", &[option("Custom…"), option("None"), option("Custom…")]);
    let error = choose_in(&popup, "Custom…", IMMEDIATE).unwrap_err();
    assert!(error.message.contains("several popup options"), "{}", error.message);
    assert_eq!(popup.performed(), ["AXPress", "AXCancel"]);
}

#[test]
fn a_disabled_option_is_not_pressed_and_the_opened_menu_is_closed() {
    let options = [
        option("Small"),
        FakeOption {
            title: "Large",
            enabled: false,
        },
    ];
    let popup = FakePopup::new("Small", &options);
    let error = choose_in(&popup, "Large", IMMEDIATE).unwrap_err();
    assert!(error.message.contains("\"Large\" is disabled"), "{}", error.message);
    assert_eq!(popup.performed(), ["AXPress", "AXCancel"]);
}

#[test]
fn a_press_the_app_does_not_take_reports_the_value_it_still_shows() {
    let popup = FakePopup {
        app_takes_choice: false,
        ..FakePopup::new("Rich Text", &formats())
    };
    let error = choose_in(&popup, "Plain Text", IMMEDIATE).unwrap_err();
    assert!(error.message.contains("still reads \"Rich Text\""), "{}", error.message);
}

#[test]
fn a_popup_whose_press_publishes_nothing_is_reopened_with_show_menu() {
    let popup = FakePopup {
        publishing_opener: Some("AXShowMenu"),
        ..FakePopup::new("Rich Text", &formats())
    };
    choose_in(&popup, "Plain Text", IMMEDIATE).unwrap();
    assert_eq!(
        popup.performed(),
        ["AXPress", "AXCancel", "AXShowMenu", "press Plain Text"]
    );
}

#[test]
fn a_menu_that_never_publishes_options_is_closed_and_reported() {
    let popup = FakePopup {
        publishing_opener: None,
        ..FakePopup::new("Rich Text", &formats())
    };
    let error = choose_in(&popup, "Plain Text", IMMEDIATE).unwrap_err();
    assert!(error.message.contains("published no options"), "{}", error.message);
    assert!(!error.message.contains("still open"), "{}", error.message);
    assert_eq!(popup.performed(), ["AXPress", "AXCancel", "AXShowMenu", "AXCancel"]);
    assert!(!popup.menu_open());
}

#[test]
fn an_empty_menu_that_will_not_close_ends_the_attempts_and_says_it_is_open() {
    let popup = FakePopup {
        publishing_opener: None,
        cancel_closes: false,
        ..FakePopup::new("Rich Text", &formats())
    };
    let error = choose_in(&popup, "Plain Text", IMMEDIATE).unwrap_err();
    assert!(
        error.message.contains("the menu this call opened is still open"),
        "{}",
        error.message
    );
    assert_eq!(popup.performed(), ["AXPress", "AXCancel"]);
}

#[test]
fn a_refusal_whose_menu_will_not_close_says_it_is_open() {
    let popup = FakePopup {
        cancel_closes: false,
        ..FakePopup::new("Rich Text", &formats())
    };
    let error = choose_in(&popup, "Missing", IMMEDIATE).unwrap_err();
    assert!(error.message.starts_with("no popup option"), "{}", error.message);
    assert!(
        error.message.ends_with("the menu this call opened is still open"),
        "{}",
        error.message
    );
}

#[test]
fn a_popup_without_an_opening_action_is_refused() {
    let popup = FakePopup {
        actions: vec!["AXIncrement"],
        ..FakePopup::new("Rich Text", &formats())
    };
    let error = choose_in(&popup, "Plain Text", IMMEDIATE).unwrap_err();
    assert!(
        error.message.contains("neither AXPress nor AXShowMenu"),
        "{}",
        error.message
    );
    assert!(popup.performed().is_empty());
}

#[test]
fn a_menu_the_user_left_open_is_not_closed_by_a_refusal() {
    let popup = FakePopup::new("Rich Text", &formats());
    popup.perform("AXPress").unwrap();
    choose_in(&popup, "Missing", IMMEDIATE).unwrap_err();
    assert_eq!(popup.performed(), ["AXPress"]);
    assert!(popup.menu_open());
}
