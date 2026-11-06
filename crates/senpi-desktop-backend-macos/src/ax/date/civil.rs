//! Proleptic Gregorian calendar arithmetic on the `CFAbsoluteTime` scale.

use super::CivilDate;

pub(super) const SECONDS_PER_DAY: i64 = 86_400;

/// Days from 1970-01-01 to 2001-01-01, the `CFAbsoluteTime` epoch.
const CF_EPOCH_DAYS: i64 = 11_323;

/// Wall-clock seconds past the `CFAbsoluteTime` epoch's local midnight.
pub(super) fn civil_seconds(date: CivilDate, seconds: f64) -> f64 {
    ((days_from_civil(date) - CF_EPOCH_DAYS) * SECONDS_PER_DAY) as f64 + seconds
}

/// Local wall-clock seconds as `YYYY-MM-DDTHH:MM:SS`.
pub(super) fn format_civil(local: f64) -> String {
    let local = local.floor() as i64;
    let date = civil_from_days(local.div_euclid(SECONDS_PER_DAY) + CF_EPOCH_DAYS);
    let clock = local.rem_euclid(SECONDS_PER_DAY);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}",
        date.year,
        date.month,
        date.day,
        clock / 3600,
        clock / 60 % 60,
        clock % 60,
    )
}

/// Seconds east of UTC as `±HH:MM`.
pub(super) fn format_offset(offset: i64) -> String {
    let sign = if offset < 0 { '-' } else { '+' };
    let minutes = offset.abs() / 60;
    format!("{sign}{:02}:{:02}", minutes / 60, minutes % 60)
}

pub(super) const fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Days since 1970-01-01 in the proleptic Gregorian calendar.
const fn days_from_civil(date: CivilDate) -> i64 {
    let year = if date.month <= 2 { date.year - 1 } else { date.year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let month_index = (date.month + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + date.day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// Inverse of [`days_from_civil`].
const fn civil_from_days(days: i64) -> CivilDate {
    let days = days + 719_468;
    let era = days.div_euclid(146_097);
    let day_of_era = days - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + if month <= 2 { 1 } else { 0 };
    CivilDate { year, month, day }
}
