mod private;
mod reader;
mod scope;
#[cfg(test)]
mod tests;

pub(crate) use private::withhold_observation;
pub(crate) use reader::Withholding;
pub(crate) use scope::admit_window_read;
