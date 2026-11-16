//! One admitted call to the session: the engine's own rows here, every other row through the
//! session's `host_call` chain (R31), so a verb a lower row serves is reached by one path.

use omo_computer_core::error::EngineCode;
use omo_computer_core::hello::{machine_id, Hello, Limits};
use omo_computer_core::methods::Method;
use omo_computer_core::params::{AdvanceClockParams, EmptyParams};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use super::refusals::{host_failure, refused, refused_call, unresolved};
use super::wire::WireError;
use super::Router;

/// Restarts bump it; a per-process engine starts at 1.
const GENERATION: u64 = 1;

fn parse<T: DeserializeOwned>(params: Value) -> Result<T, WireError> {
    serde_json::from_value(params).map_err(|error| WireError::invalid_params(&error))
}

fn empty(params: Value) -> Result<(), WireError> {
    parse::<EmptyParams>(params).map(drop)
}

pub fn dispatch(router: &mut Router, method: Method, params: Value) -> Result<Value, WireError> {
    let session = &mut router.session;
    let value = match method {
        Method::EngineHello => {
            empty(params)?;
            json!(hello(&router.ctx.machine_key))
        }
        Method::SessionOpen => {
            let opened = session.open(parse(params)?).map_err(|r| refused(&r))?;
            router.resume_token = Some(opened.resume_token.clone());
            json!(opened)
        }
        Method::StopPathStart => json!(session.stop_path_start(parse(params)?)),
        Method::StopPathStop => {
            let status = session.stop_path_stop(parse(params)?);
            router.stop_epoch += 1;
            json!(status)
        }
        Method::StopPathStatus => {
            empty(params)?;
            json!(session.stop_path_status())
        }
        Method::StopPathHeartbeat => {
            empty(params)?;
            session.stop_path_heartbeat();
            Value::Null
        }
        Method::StopPathResume => return super::resume::resume(router, params),
        Method::SessionClose => {
            empty(params)?;
            session.close();
            Value::Null
        }
        Method::Capabilities => {
            empty(params)?;
            json!(session.capabilities())
        }
        Method::Displays => {
            empty(params)?;
            json!(session.displays().map_err(|r| refused(&r))?)
        }
        Method::Windows => json!(session.windows(parse(params)?).map_err(|r| refused(&r))?),
        Method::Capture => json!(session.capture(parse(params)?).map_err(|r| refused(&r))?),
        Method::Click => json!(session.click(parse(params)?).map_err(|r| refused_call(&r))?),
        Method::TypeText => json!(session.type_text(parse(params)?).map_err(|r| refused_call(&r))?),
        Method::Observe => json!(session.observe(parse(params)?).map_err(|u| unresolved(&u))?),
        Method::AxDrill => json!(session.drill(parse(params)?).map_err(|u| unresolved(&u))?),
        Method::AxNode => json!(session.ax_node(parse(params)?).map_err(|u| unresolved(&u))?),
        Method::AxChildren => json!(session.ax_children(parse(params)?).map_err(|u| unresolved(&u))?),
        Method::TestAdvanceClock => {
            let AdvanceClockParams { ms } = parse(params)?;
            let clock = router.ctx.fake_clock.as_ref().ok_or_else(|| WireError::rejected("testOnly"))?;
            clock.advance(ms);
            Value::Null
        }
        Method::Cancel => Value::Null,
        _ => {
            return session
                .host_call(method, params)
                .map_or_else(|| Err(WireError::rejected("unknown")), |r| r.map_err(host_failure))
        }
    };
    Ok(value)
}

fn hello(machine_key: &[u8]) -> Hello {
    Hello::new(
        env!("CARGO_PKG_VERSION"),
        option_env!("OMO_COMPUTER_BUILD_SHA").unwrap_or("unknown"),
        GENERATION,
        Limits::local(),
        machine_id(machine_key, 0),
    )
}

/// A call refused before it reaches the session because a stop overtook it.
#[must_use]
pub fn overtaken() -> WireError {
    WireError::bare(EngineCode::Suspended)
}
