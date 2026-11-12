//! `Windows.Graphics.Capture`: a free-threaded frame pool with one B8G8R8A8 buffer,
//! `TryGetNextFrame` polled in 10 ms slices up to 500 ms, the frame copied through a staging
//! texture (d-windows.md '## Capture', 'WGC first, in the engine process').

use std::time::{Duration, Instant};

use windows::core::Interface;
use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::HMODULE;
use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_CPU_ACCESS_READ,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE, D3D11_MAP_READ, D3D11_SDK_VERSION,
    D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::System::WinRT::Direct3D11::{
    CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess,
};

use super::os::Os;
use super::{CaptureFault, RawFrame};
use crate::displays::PhysRect;

/// `TryGetNextFrame` is polled in slices of this length (d-windows.md '## Capture').
const WGC_SLICE: Duration = Duration::from_millis(10);
/// The per-frame deadline of a WGC capture (d-windows.md '## Capture').
const WGC_DEADLINE: Duration = Duration::from_millis(500);

impl Os {
    fn device(
        &mut self,
    ) -> windows::core::Result<&(ID3D11Device, ID3D11DeviceContext, IDirect3DDevice)> {
        if self.device.is_none() {
            let mut device = None;
            let mut context = None;
            // SAFETY: out-parameters only; the hardware driver with BGRA support WGC needs.
            unsafe {
                D3D11CreateDevice(
                    None,
                    D3D_DRIVER_TYPE_HARDWARE,
                    HMODULE::default(),
                    D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                    None,
                    D3D11_SDK_VERSION,
                    Some(&mut device),
                    None,
                    Some(&mut context),
                )?;
            }
            let device: ID3D11Device = device.ok_or_else(windows::core::Error::empty)?;
            let context = context.ok_or_else(windows::core::Error::empty)?;
            let dxgi: IDXGIDevice = device.cast()?;
            // SAFETY: `dxgi` is a live DXGI device.
            let winrt: IDirect3DDevice =
                unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)? }.cast()?;
            self.device = Some((device, context, winrt));
        }
        self.device.as_ref().ok_or_else(windows::core::Error::empty)
    }

    pub(super) fn wgc(
        &mut self,
        item: &GraphicsCaptureItem,
        origin: PhysRect,
        cursor: bool,
    ) -> Result<RawFrame, CaptureFault> {
        let (device, context, winrt) = self
            .device()
            .map_err(|_| CaptureFault::ItemUnavailable)?
            .clone();
        let size = item.Size().map_err(|_| CaptureFault::ItemUnavailable)?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &winrt,
            DirectXPixelFormat::B8G8R8A8UIntNormalized,
            1,
            size,
        )
        .map_err(|_| CaptureFault::ItemUnavailable)?;
        let session = pool
            .CreateCaptureSession(item)
            .map_err(|_| CaptureFault::ItemUnavailable)?;
        session
            .SetIsCursorCaptureEnabled(cursor)
            .map_err(|_| CaptureFault::ItemUnavailable)?;
        session
            .StartCapture()
            .map_err(|_| CaptureFault::ItemUnavailable)?;
        let started = Instant::now();
        let frame = loop {
            if let Ok(frame) = pool.TryGetNextFrame() {
                break frame;
            }
            if started.elapsed() >= WGC_DEADLINE {
                let _ = session.Close();
                let _ = pool.Close();
                return Err(CaptureFault::Timeout);
            }
            std::thread::sleep(WGC_SLICE);
        };
        let pixels = read_surface(&device, &context, &frame);
        let _ = frame.Close();
        let _ = session.Close();
        let _ = pool.Close();
        let (width, height, bgra) = pixels.map_err(|_| CaptureFault::NullFrame)?;
        Ok(RawFrame {
            width,
            height,
            bgra,
            origin: PhysRect {
                x: origin.x,
                y: origin.y,
                width: i32::try_from(width).unwrap_or(i32::MAX),
                height: i32::try_from(height).unwrap_or(i32::MAX),
            },
        })
    }
}

fn read_surface(
    device: &ID3D11Device,
    context: &ID3D11DeviceContext,
    frame: &windows::Graphics::Capture::Direct3D11CaptureFrame,
) -> windows::core::Result<(u32, u32, Vec<u8>)> {
    let access: IDirect3DDxgiInterfaceAccess = frame.Surface()?.cast()?;
    // SAFETY: the surface of a live capture frame is an ID3D11Texture2D.
    let texture: ID3D11Texture2D = unsafe { access.GetInterface()? };
    let mut desc = D3D11_TEXTURE2D_DESC::default();
    // SAFETY: plain out-parameter.
    unsafe { texture.GetDesc(&mut desc) };
    desc.Usage = D3D11_USAGE_STAGING;
    desc.BindFlags = 0;
    desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
    desc.MiscFlags = 0;
    let mut staging = None;
    // SAFETY: a staging copy of the frame texture, read back below.
    unsafe { device.CreateTexture2D(&desc, None, Some(&mut staging))? };
    let staging: ID3D11Texture2D = staging.ok_or_else(windows::core::Error::empty)?;
    // SAFETY: both textures belong to `device` and share a description.
    unsafe { context.CopyResource(&staging, &texture) };
    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
    // SAFETY: the staging texture has CPU read access; unmapped below.
    unsafe { context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))? };
    let row = desc.Width as usize * 4;
    let pitch = mapped.RowPitch as usize;
    let mut bgra = Vec::with_capacity(row * desc.Height as usize);
    for y in 0..desc.Height as usize {
        // SAFETY: `mapped.pData` covers `RowPitch * Height` bytes while mapped.
        let line =
            unsafe { std::slice::from_raw_parts(mapped.pData.cast::<u8>().add(y * pitch), row) };
        bgra.extend_from_slice(line);
    }
    // SAFETY: mapped above.
    unsafe { context.Unmap(&staging, 0) };
    Ok((desc.Width, desc.Height, bgra))
}
