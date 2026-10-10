use std::io::{Seek, Write};
use std::os::fd::AsFd;
use std::os::unix::net::UnixStream;
use std::sync::PoisonError;

use reis::eis;
use reis::handshake::EisHandshaker;
use reis::request::{DeviceCapability, EisRequest, EisRequestConverter, Seat};
use reis::PendingRequestResult;
use tokio::io::unix::AsyncFd;

use super::{update, DeviceTopology, EisConfig, Recorded, Shared, SharedDevices};
use crate::capture::layout::EisRegion;

async fn next_requests(fd: &AsyncFd<eis::Context>) -> Result<Option<Vec<eis::Request>>, String> {
    loop {
        let mut guard = fd.readable().await.map_err(|error| error.to_string())?;
        match guard.get_inner().read() {
            Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => guard.clear_ready(),
            Err(error) => return Err(error.to_string()),
            Ok(_) => {
                guard.clear_ready();
                let mut requests = Vec::new();
                while let Some(pending) = guard.get_inner().pending_request() {
                    match pending {
                        PendingRequestResult::Request(request) => requests.push(request),
                        PendingRequestResult::ParseError(error) => return Err(error.to_string()),
                        PendingRequestResult::InvalidObject(_) => {}
                    }
                }
                if !requests.is_empty() {
                    return Ok(Some(requests));
                }
            }
        }
    }
}

pub(super) async fn serve(
    stream: UnixStream,
    config: EisConfig,
    topology: DeviceTopology,
    regions: &[EisRegion],
    log: &Shared,
    devices: &SharedDevices,
) -> Result<(), String> {
    let context = eis::Context::new(stream).map_err(|error| error.to_string())?;
    let fd = AsyncFd::new(context.clone()).map_err(|error| error.to_string())?;
    let mut handshaker = EisHandshaker::new(&context, 0);
    let mut converter: Option<EisRequestConverter> = None;
    let mut seats: Vec<(Seat, bool, bool)> = Vec::new();
    while let Some(requests) = next_requests(&fd).await? {
        for request in requests {
            match converter.as_mut() {
                Some(converter) => converter
                    .handle_request(request)
                    .map_err(|error| error.to_string())?,
                None => {
                    if let Some(response) = handshaker
                        .handle_request(request)
                        .map_err(|error| error.to_string())?
                    {
                        let started = EisRequestConverter::new(&context, response, 0);
                        seats = add_seats(started.handle(), topology);
                        {
                            let (lock, changed) = &**devices;
                            lock.lock()
                                .unwrap_or_else(PoisonError::into_inner)
                                .connection = Some(started.handle().clone());
                            changed.notify_all();
                        }
                        converter = Some(started);
                    }
                }
            }
        }
        let Some(converter) = converter.as_mut() else {
            context.flush().map_err(|error| error.to_string())?;
            continue;
        };
        while let Some(request) = converter.next_request() {
            match request {
                EisRequest::Bind(binding) => {
                    if let Some((seat, keyboard, pointer)) =
                        seats.iter().find(|(seat, _, _)| seat == &binding.seat)
                    {
                        add_devices(
                            seat,
                            converter.handle(),
                            config,
                            (*keyboard, *pointer),
                            regions,
                            devices,
                        )?;
                    }
                }
                EisRequest::KeyboardKey(key) => update(log, |log| {
                    log.events.push(Recorded::Key {
                        keycode: key.key,
                        pressed: key.state == eis::keyboard::KeyState::Press,
                    });
                }),
                EisRequest::Button(button) => update(log, |log| {
                    log.events.push(Recorded::Button {
                        code: button.button,
                        pressed: button.state == eis::button::ButtonState::Press,
                    });
                }),
                EisRequest::PointerMotionAbsolute(motion) => update(log, |log| {
                    log.events.push(Recorded::Motion {
                        x: motion.dx_absolute,
                        y: motion.dy_absolute,
                    });
                }),
                EisRequest::ScrollDelta(scroll) => update(log, |log| {
                    log.continuous_scroll.push((scroll.dx, scroll.dy));
                }),
                EisRequest::ScrollDiscrete(scroll) => update(log, |log| {
                    log.discrete_scroll
                        .push((scroll.discrete_dx, scroll.discrete_dy));
                }),
                EisRequest::DeviceStopEmulating(_) => update(log, |log| log.bursts += 1),
                EisRequest::Disconnect => return Ok(()),
                _ => {}
            }
        }
        context.flush().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn add_seats(
    connection: &reis::request::Connection,
    topology: DeviceTopology,
) -> Vec<(Seat, bool, bool)> {
    let capabilities = [
        DeviceCapability::Pointer,
        DeviceCapability::PointerAbsolute,
        DeviceCapability::Keyboard,
        DeviceCapability::Scroll,
        DeviceCapability::Button,
    ];
    match topology {
        DeviceTopology::BothSameSeat => vec![(
            connection.add_seat(Some("default"), &capabilities),
            true,
            true,
        )],
        DeviceTopology::PointerOnly => vec![(
            connection.add_seat(Some("pointer"), &capabilities),
            false,
            true,
        )],
        DeviceTopology::SplitSeats => vec![
            (
                connection.add_seat(Some("pointer"), &capabilities),
                false,
                true,
            ),
            (
                connection.add_seat(Some("keyboard"), &capabilities),
                true,
                false,
            ),
        ],
    }
}

fn add_devices(
    seat: &Seat,
    connection: &reis::request::Connection,
    config: EisConfig,
    (with_keyboard, with_pointer): (bool, bool),
    regions: &[EisRegion],
    controls: &SharedDevices,
) -> Result<(), String> {
    if with_keyboard {
        let mut keymap = tempfile::tempfile().map_err(|error| error.to_string())?;
        keymap
            .write_all(config.keymap.as_bytes())
            .map_err(|error| error.to_string())?;
        keymap.rewind().map_err(|error| error.to_string())?;
        let size = u32::try_from(config.keymap.len()).map_err(|error| error.to_string())?;
        let keyboard = seat.add_device(
            Some("keyboard"),
            eis::device::DeviceType::Virtual,
            &[DeviceCapability::Keyboard],
            |device| {
                if let Some(interface) = device.interface::<eis::Keyboard>() {
                    interface.keymap(eis::keyboard::KeymapType::Xkb, size, keymap.as_fd());
                }
            },
        );
        if let Some(interface) = keyboard.interface::<eis::Keyboard>() {
            connection
                .with_next_serial(|serial| interface.modifiers(serial, 0, 0, 0, config.group));
        }
        keyboard.resumed();
    }
    if with_pointer {
        let pointer = add_pointer(seat, regions);
        let (lock, changed) = &**controls;
        let mut controlled = lock.lock().unwrap_or_else(PoisonError::into_inner);
        controlled.pointer = Some(pointer);
        controlled.pointer_seat = Some(seat.clone());
        changed.notify_all();
    }
    Ok(())
}

/// A resumed absolute pointer with a button and scroll over `regions`.
pub(super) fn add_pointer(seat: &Seat, regions: &[EisRegion]) -> reis::request::Device {
    let pointer = seat.add_device(
        Some("pointer"),
        eis::device::DeviceType::Virtual,
        &[
            DeviceCapability::PointerAbsolute,
            DeviceCapability::Button,
            DeviceCapability::Scroll,
        ],
        |device| {
            for region in regions {
                device
                    .device()
                    .region(region.x, region.y, region.width, region.height, region.scale);
            }
        },
    );
    pointer.resumed();
    pointer
}
