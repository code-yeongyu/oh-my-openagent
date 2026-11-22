//! Cross-member checks: every window a member names is listed, and every count starts at 1.

use super::invalid::escape;
use super::{FakeScenario, InvalidKind, ScenarioInvalid};
use crate::faults::Fault;

fn reference(pointer: String, reason: String) -> ScenarioInvalid {
    ScenarioInvalid {
        kind: InvalidKind::Reference,
        pointer,
        reason,
    }
}

/// The windows each member names, as (pointer, window id).
fn named_windows(scenario: &FakeScenario) -> Vec<(String, &str)> {
    let mut named: Vec<(String, &str)> = Vec::new();
    let keyed = [
        ("ax", scenario.ax.keys().collect::<Vec<_>>()),
        ("ax_node_count", scenario.ax_node_count.keys().collect()),
        ("identity", scenario.identity.keys().collect()),
        ("menus", scenario.menus.keys().collect()),
        (
            "window_frame_policy",
            scenario.window_frame_policy.keys().collect(),
        ),
        (
            "window_reservation",
            scenario.window_reservation.keys().collect(),
        ),
    ];
    for (member, ids) in keyed {
        named.extend(
            ids.into_iter()
                .map(|id| (format!("/{member}/{}", escape(id)), id.as_str())),
        );
    }
    let listed = [
        (
            "identity_changes",
            scenario
                .identity_changes
                .iter()
                .map(|c| c.window.as_str())
                .collect::<Vec<_>>(),
        ),
        (
            "focus_reads",
            scenario
                .focus_reads
                .iter()
                .map(|r| r.window.as_str())
                .collect(),
        ),
        (
            "ax_notification_timeline",
            scenario
                .ax_notification_timeline
                .iter()
                .map(|n| n.window.as_str())
                .collect(),
        ),
        (
            "busy_timeline",
            scenario
                .busy_timeline
                .iter()
                .map(|b| b.window.as_str())
                .collect(),
        ),
        (
            "target_exit",
            scenario
                .target_exit
                .iter()
                .map(|t| t.window.as_str())
                .collect(),
        ),
    ];
    for (member, ids) in listed {
        named.extend(
            ids.into_iter()
                .enumerate()
                .map(|(index, id)| (format!("/{member}/{index}/window"), id)),
        );
    }
    if let Some(secure) = &scenario.secure_focus {
        named.push(("/secure_focus/window".to_owned(), secure.window.as_str()));
    }
    named
}

fn counts(scenario: &FakeScenario) -> Vec<(String, u32)> {
    let mut all: Vec<(String, u32)> = Vec::new();
    all.extend(
        scenario
            .identity_changes
            .iter()
            .enumerate()
            .map(|(i, c)| (format!("/identity_changes/{i}/nth"), c.nth)),
    );
    all.extend(
        scenario
            .epoch_events
            .iter()
            .enumerate()
            .map(|(i, e)| (format!("/epoch_events/{i}/nth"), e.nth)),
    );
    all.extend(
        scenario
            .target_exit
            .iter()
            .enumerate()
            .map(|(i, t)| (format!("/target_exit/{i}/nth"), t.nth)),
    );
    all.extend(
        scenario
            .displays_change
            .iter()
            .map(|d| ("/displays_change/nth".to_owned(), d.nth)),
    );
    all
}

pub(super) fn check(scenario: &FakeScenario) -> Result<(), ScenarioInvalid> {
    if let Some((index, failure)) = scenario.fail_next.iter().enumerate().find(|(_, failure)| {
        Fault::Fail {
            code: failure.code,
            reason: failure.reason,
        }
        .check()
        .is_err()
    }) {
        return Err(reference(
            format!("/fail_next/{index}"),
            format!("{failure:?} has no row in the COMPUTER_* table"),
        ));
    }
    let listed = |id: &str| scenario.windows.iter().any(|window| window.id == id);
    if let Some((pointer, id)) = named_windows(scenario)
        .into_iter()
        .find(|(_, id)| !listed(id))
    {
        return Err(reference(
            pointer,
            format!("window {id:?} is not in /windows"),
        ));
    }
    if let Some(id) = scenario
        .ax_node_count
        .keys()
        .find(|id| !scenario.ax.contains_key(*id))
    {
        return Err(reference(
            format!("/ax_node_count/{}", escape(id)),
            format!("window {id:?} has no scripted tree in /ax"),
        ));
    }
    if let Some((pointer, _)) = counts(scenario).into_iter().find(|(_, nth)| *nth == 0) {
        return Err(reference(pointer, "calls are counted from 1".to_owned()));
    }
    if let Some((index, _)) = scenario
        .ax_cannot_complete
        .iter()
        .enumerate()
        .find(|(_, method)| !method.is_ax_write())
    {
        return Err(reference(
            format!("/ax_cannot_complete/{index}"),
            "only an AX write can be left unanswered".to_owned(),
        ));
    }
    Ok(())
}
