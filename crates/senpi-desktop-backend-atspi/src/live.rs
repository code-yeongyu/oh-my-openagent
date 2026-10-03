//! `AtSpiBus` over D-Bus: each shim method is one bounded round trip through
//! the AT-SPI interface proxy that owns it.

use atspi::proxy::accessible::AccessibleProxy;
use atspi::proxy::action::ActionProxy;
use atspi::proxy::component::ComponentProxy;
use atspi::proxy::editable_text::EditableTextProxy;
use atspi::proxy::text::TextProxy;
use atspi::proxy::value::ValueProxy;
use atspi::{CoordType, InterfaceSet, ObjectRefOwned, Role, StateSet};

use crate::bus::{AtSpiBus, BusResult, Extents, ScreenPoint};
use crate::connection::LiveBus;

type Accessible = AccessibleProxy<'static>;

impl AtSpiBus for LiveBus {
    type Node = ObjectRefOwned;

    fn applications(&mut self) -> BusResult<Vec<ObjectRefOwned>> {
        LiveBus::applications(self)
    }

    fn process_id(&mut self, app: &ObjectRefOwned) -> Option<u32> {
        LiveBus::process_id(self, app)
    }

    fn is_null(&self, node: &ObjectRefOwned) -> bool {
        node.is_null()
    }

    fn object_id(&self, node: &ObjectRefOwned) -> String {
        format!(
            "atspi:{}:{}",
            node.name_as_str().unwrap_or_default(),
            node.path_as_str()
        )
    }

    fn name(&mut self, node: &ObjectRefOwned) -> BusResult<String> {
        self.with_proxy("name", node, |p: Accessible| async move { p.name().await })
    }

    fn description(&mut self, node: &ObjectRefOwned) -> BusResult<String> {
        self.with_proxy("description", node, |p: Accessible| async move {
            p.description().await
        })
    }

    fn role(&mut self, node: &ObjectRefOwned) -> BusResult<Role> {
        self.with_proxy("role", node, |p: Accessible| async move { p.get_role().await })
    }

    fn role_name(&mut self, node: &ObjectRefOwned) -> BusResult<String> {
        self.with_proxy("role name", node, |p: Accessible| async move {
            p.get_role_name().await
        })
    }

    fn localized_role_name(&mut self, node: &ObjectRefOwned) -> BusResult<String> {
        self.with_proxy("localized role name", node, |p: Accessible| async move {
            p.get_localized_role_name().await
        })
    }

    fn state(&mut self, node: &ObjectRefOwned) -> BusResult<StateSet> {
        self.with_proxy("state", node, |p: Accessible| async move { p.get_state().await })
    }

    fn interfaces(&mut self, node: &ObjectRefOwned) -> BusResult<InterfaceSet> {
        self.with_proxy("interfaces", node, |p: Accessible| async move {
            p.get_interfaces().await
        })
    }

    fn attributes(&mut self, node: &ObjectRefOwned) -> BusResult<Vec<(String, String)>> {
        self.with_proxy("attributes", node, |p: Accessible| async move {
            Ok(p.get_attributes().await?.into_iter().collect())
        })
    }

    fn children(&mut self, node: &ObjectRefOwned) -> BusResult<Vec<ObjectRefOwned>> {
        self.with_proxy(
            "children",
            node,
            |p: Accessible| async move { p.get_children().await },
        )
    }

    fn child_count(&mut self, node: &ObjectRefOwned) -> BusResult<i32> {
        self.with_proxy("child count", node, |p: Accessible| async move {
            p.child_count().await
        })
    }

    fn parent(&mut self, node: &ObjectRefOwned) -> BusResult<ObjectRefOwned> {
        self.with_proxy("parent", node, |p: Accessible| async move { p.parent().await })
    }

    fn extents(&mut self, node: &ObjectRefOwned) -> BusResult<Extents> {
        self.with_proxy("extents", node, |p: ComponentProxy<'static>| async move {
            let (x, y, width, height) = p.get_extents(CoordType::Screen).await?;
            Ok(Extents { x, y, width, height })
        })
    }

    fn contains(&mut self, node: &ObjectRefOwned, point: ScreenPoint) -> BusResult<bool> {
        self.with_proxy("contains", node, |p: ComponentProxy<'static>| async move {
            p.contains(point.x, point.y, CoordType::Screen).await
        })
    }

    fn accessible_at_point(
        &mut self,
        node: &ObjectRefOwned,
        point: ScreenPoint,
    ) -> BusResult<ObjectRefOwned> {
        self.with_proxy(
            "element at point",
            node,
            |p: ComponentProxy<'static>| async move {
                p.get_accessible_at_point(point.x, point.y, CoordType::Screen)
                    .await
            },
        )
    }

    fn grab_focus(&mut self, node: &ObjectRefOwned) -> BusResult<bool> {
        self.with_proxy("focus", node, |p: ComponentProxy<'static>| async move {
            p.grab_focus().await
        })
    }

    fn actions(&mut self, node: &ObjectRefOwned) -> BusResult<Vec<String>> {
        self.with_proxy("actions", node, |p: ActionProxy<'static>| async move {
            Ok(p.get_actions().await?.into_iter().map(|a| a.name).collect())
        })
    }

    fn do_action(&mut self, node: &ObjectRefOwned, index: i32) -> BusResult<bool> {
        self.with_proxy("action", node, |p: ActionProxy<'static>| async move {
            p.do_action(index).await
        })
    }

    fn text(&mut self, node: &ObjectRefOwned, max_chars: i32) -> BusResult<String> {
        self.with_proxy("text", node, |p: TextProxy<'static>| async move {
            let count = p.character_count().await?.min(max_chars);
            p.get_text(0, count).await
        })
    }

    fn set_text_contents(&mut self, node: &ObjectRefOwned, text: &str) -> BusResult<bool> {
        self.with_proxy("text value", node, |p: EditableTextProxy<'static>| async move {
            p.set_text_contents(text).await
        })
    }

    fn set_current_value(&mut self, node: &ObjectRefOwned, value: f64) -> BusResult<()> {
        self.with_proxy("value", node, |p: ValueProxy<'static>| async move {
            p.set_current_value(value).await
        })
    }
}
