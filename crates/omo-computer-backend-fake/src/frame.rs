//! A minimal, deterministic PNG writer for the fake's captures: 8-bit gray, stored
//! (uncompressed) deflate blocks, so a frame costs a copy and never depends on a codec. The
//! frame carries the pointer glyph by default and the crosshair a `crosshair` capture asks for.

const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1A, b'\n'];
const MAX_STORED: usize = 65_535;

/// A non-negative pixel count from a logical length; fractional pixels round down.
#[must_use]
pub fn pixels(length: f64) -> u32 {
    if length.is_finite() && length > 0.0 {
        // The value is clamped to the u32 range first, so the cast cannot wrap.
        length.min(f64::from(u32::MAX)) as u32
    } else {
        0
    }
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFF_u32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

fn adler32(bytes: &[u8]) -> u32 {
    let (mut a, mut b) = (1_u32, 0_u32);
    for byte in bytes {
        a = (a + u32::from(*byte)) % 65_521;
        b = (b + a) % 65_521;
    }
    (b << 16) | a
}

fn chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    let length = u32::try_from(data.len()).unwrap_or(u32::MAX);
    out.extend_from_slice(&length.to_be_bytes());
    let start = out.len();
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let crc = crc32(&out[start..]);
    out.extend_from_slice(&crc.to_be_bytes());
}

fn zlib_stored(raw: &[u8]) -> Vec<u8> {
    let mut out = vec![0x78, 0x01];
    let blocks: Vec<&[u8]> = if raw.is_empty() {
        vec![&[]]
    } else {
        raw.chunks(MAX_STORED).collect()
    };
    let last = blocks.len() - 1;
    for (index, block) in blocks.into_iter().enumerate() {
        out.push(u8::from(index == last));
        let length = u16::try_from(block.len()).unwrap_or(u16::MAX);
        out.extend_from_slice(&length.to_le_bytes());
        out.extend_from_slice(&(!length).to_le_bytes());
        out.extend_from_slice(block);
    }
    out.extend_from_slice(&adler32(raw).to_be_bytes());
    out
}

/// The gray level of the pointer glyph a default frame carries.
pub const POINTER_GRAY: u8 = 0x00;
/// The gray level of the crosshair a `crosshair` capture draws.
pub const CROSSHAIR_GRAY: u8 = 0xFF;
/// Half the side of the square pointer glyph centred on the hot spot.
const POINTER_HALF: i64 = 1;
/// The arm length of the crosshair either side of its centre.
const CROSSHAIR_ARM: i64 = 4;

/// The gray pixels of one frame, held as PNG scanlines (a filter byte, then the row).
pub struct Raster {
    width: u32,
    height: u32,
    rows: Vec<u8>,
}

impl Raster {
    /// A frame of one gray level.
    #[must_use]
    pub fn filled(width: u32, height: u32, gray: u8) -> Self {
        let row_len = usize::try_from(width).unwrap_or(0);
        let count = usize::try_from(height).unwrap_or(0);
        let mut rows = Vec::with_capacity((row_len + 1) * count);
        for _ in 0..count {
            rows.push(0);
            rows.resize(rows.len() + row_len, gray);
        }
        Self {
            width,
            height,
            rows,
        }
    }

    fn set(&mut self, x: i64, y: i64, gray: u8) {
        let (Ok(x), Ok(y)) = (u32::try_from(x), u32::try_from(y)) else {
            return;
        };
        if x < self.width && y < self.height {
            let row_len = usize::try_from(self.width).unwrap_or(0) + 1;
            let index = usize::try_from(y).unwrap_or(0) * row_len + 1 + usize::try_from(x).unwrap_or(0);
            if let Some(pixel) = self.rows.get_mut(index) {
                *pixel = gray;
            }
        }
    }

    /// The pixel holding the frame point `(x, y)`.
    fn cell(x: f64, y: f64) -> (i64, i64) {
        // `floor` of a finite frame coordinate; a non-finite one lands outside the frame.
        (x.floor() as i64, y.floor() as i64)
    }

    /// The pointer glyph, centred on the hot spot `(x, y)` in frame pixels.
    pub fn pointer(&mut self, x: f64, y: f64) {
        let (cx, cy) = Self::cell(x, y);
        for dy in -POINTER_HALF..=POINTER_HALF {
            for dx in -POINTER_HALF..=POINTER_HALF {
                self.set(cx + dx, cy + dy, POINTER_GRAY);
            }
        }
    }

    /// The crosshair centred on `(x, y)` in frame pixels.
    pub fn crosshair(&mut self, x: f64, y: f64) {
        let (cx, cy) = Self::cell(x, y);
        for d in -CROSSHAIR_ARM..=CROSSHAIR_ARM {
            self.set(cx + d, cy, CROSSHAIR_GRAY);
            self.set(cx, cy + d, CROSSHAIR_GRAY);
        }
    }

    /// The 8-bit grayscale PNG of the frame.
    #[must_use]
    pub fn png(&self) -> Vec<u8> {
        let mut header = Vec::with_capacity(13);
        header.extend_from_slice(&self.width.to_be_bytes());
        header.extend_from_slice(&self.height.to_be_bytes());
        header.extend_from_slice(&[8, 0, 0, 0, 0]);
        let mut out = SIGNATURE.to_vec();
        chunk(&mut out, b"IHDR", &header);
        chunk(&mut out, b"IDAT", &zlib_stored(&self.rows));
        chunk(&mut out, b"IEND", &[]);
        out
    }
}
