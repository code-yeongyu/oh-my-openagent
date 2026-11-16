use crate::uia::control_type::name_of;

#[test]
fn control_type_ids_name_their_roles() {
    assert_eq!(name_of(50_000), "Button");
    assert_eq!(name_of(50_004), "Edit");
    assert_eq!(name_of(50_032), "Window");
    assert_eq!(name_of(50_040), "AppBar");
    assert_eq!(name_of(50_041), "Custom", "past the table");
    assert_eq!(name_of(0), "Custom");
}
