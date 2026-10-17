//! The two SPA pods the capture exchanges, built and read in Rust: libspa's
//! pod builder is inline C in headers, so nothing links to it. Layout per
//! `spa/pod/pod.h`: every pod is `{size: u32, type: u32}` then `size` body
//! bytes, padded to 8; an Object body is `{type, id}` then props
//! `{key, flags, pod}`; a Choice body is `{type, flags, child pod header}`
//! then the child values.

const TYPE_ID: u32 = 3;
const TYPE_RECTANGLE: u32 = 10;
const TYPE_OBJECT: u32 = 15;
const TYPE_CHOICE: u32 = 19;
const OBJECT_FORMAT: u32 = 0x40003;
const PARAM_ENUM_FORMAT: u32 = 3;
const FORMAT_MEDIA_TYPE: u32 = 1;
const FORMAT_MEDIA_SUBTYPE: u32 = 2;
const FORMAT_VIDEO_FORMAT: u32 = 0x20001;
const FORMAT_VIDEO_SIZE: u32 = 0x20003;
const MEDIA_TYPE_VIDEO: u32 = 2;
const MEDIA_SUBTYPE_RAW: u32 = 1;
const CHOICE_NONE: u32 = 0;
const CHOICE_RANGE: u32 = 1;
const CHOICE_ENUM: u32 = 3;

/// `enum spa_video_format` values of the packed RGB formats the capture reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoFormat {
    Rgbx = 7,
    Bgrx = 8,
    Rgba = 11,
    Bgra = 12,
    Rgb = 15,
    Bgr = 16,
}

impl VideoFormat {
    const OFFERED: [Self; 6] = [
        Self::Bgrx,
        Self::Bgra,
        Self::Rgbx,
        Self::Rgba,
        Self::Rgb,
        Self::Bgr,
    ];

    fn from_raw(raw: u32) -> Option<Self> {
        Self::OFFERED.into_iter().find(|format| *format as u32 == raw)
    }

    pub const fn bytes_per_pixel(self) -> usize {
        match self {
            Self::Rgb | Self::Bgr => 3,
            _ => 4,
        }
    }
}

fn words(out: &mut Vec<u8>, values: &[u32]) {
    for value in values {
        out.extend_from_slice(&value.to_ne_bytes());
    }
}

fn pad(out: &mut Vec<u8>) {
    while !out.len().is_multiple_of(8) {
        out.push(0);
    }
}

fn prop(out: &mut Vec<u8>, key: u32, pod: &[u8]) {
    words(out, &[key, 0]);
    out.extend_from_slice(pod);
    pad(out);
}

fn id_pod(value: u32) -> Vec<u8> {
    let mut pod = Vec::new();
    words(&mut pod, &[4, TYPE_ID, value, 0]);
    pod
}

fn choice(kind: u32, child_type: u32, child_size: u32, values: &[Vec<u32>]) -> Vec<u8> {
    let mut body = Vec::new();
    words(&mut body, &[kind, 0, child_size, child_type]);
    for value in values {
        words(&mut body, value);
    }
    let mut pod = Vec::new();
    words(
        &mut pod,
        &[u32::try_from(body.len()).unwrap_or(u32::MAX), TYPE_CHOICE],
    );
    pod.extend_from_slice(&body);
    pad(&mut pod);
    pod
}

/// The `EnumFormat` param: raw video in any offered packed RGB format and
/// any size up to 16384x16384, preferring BGRx at 1920x1080.
pub fn enum_format() -> Vec<u8> {
    let mut formats = vec![vec![VideoFormat::Bgrx as u32]];
    formats.extend(VideoFormat::OFFERED.iter().map(|format| vec![*format as u32]));
    let size = choice(
        CHOICE_RANGE,
        TYPE_RECTANGLE,
        8,
        &[vec![1920, 1080], vec![1, 1], vec![16384, 16384]],
    );
    let mut body = Vec::new();
    words(&mut body, &[OBJECT_FORMAT, PARAM_ENUM_FORMAT]);
    prop(&mut body, FORMAT_MEDIA_TYPE, &id_pod(MEDIA_TYPE_VIDEO));
    prop(&mut body, FORMAT_MEDIA_SUBTYPE, &id_pod(MEDIA_SUBTYPE_RAW));
    prop(
        &mut body,
        FORMAT_VIDEO_FORMAT,
        &choice(CHOICE_ENUM, TYPE_ID, 4, &formats),
    );
    prop(&mut body, FORMAT_VIDEO_SIZE, &size);
    let mut pod = Vec::new();
    words(
        &mut pod,
        &[u32::try_from(body.len()).unwrap_or(u32::MAX), TYPE_OBJECT],
    );
    pod.extend_from_slice(&body);
    pod
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Negotiated {
    pub format: VideoFormat,
    pub width: u32,
    pub height: u32,
}

fn word(bytes: &[u8], at: usize) -> Option<u32> {
    bytes
        .get(at..at + 4)
        .and_then(|slice| slice.try_into().ok())
        .map(u32::from_ne_bytes)
}

fn first_value(pod: &[u8]) -> Option<(u32, &[u8])> {
    let (size, kind) = (word(pod, 0)? as usize, word(pod, 4)?);
    let body = pod.get(8..8 + size)?;
    if kind != TYPE_CHOICE {
        return Some((kind, body));
    }
    let (choice_kind, child_size, child_type) = (word(body, 0)?, word(body, 8)? as usize, word(body, 12)?);
    if ![CHOICE_NONE, CHOICE_RANGE, CHOICE_ENUM].contains(&choice_kind) {
        return None;
    }
    Some((child_type, body.get(16..16 + child_size)?))
}

/// Reads a `Format` object pod; `None` for anything this capture cannot use.
pub fn parse_format(pod: &[u8]) -> Option<Negotiated> {
    let (size, kind) = (word(pod, 0)? as usize, word(pod, 4)?);
    if kind != TYPE_OBJECT || word(pod, 8)? != OBJECT_FORMAT {
        return None;
    }
    let end = 8 + size;
    let (mut at, mut format, mut dims) = (16, None, None);
    while at + 16 <= end {
        let key = word(pod, at)?;
        let value = pod.get(at + 8..end)?;
        let value_size = word(value, 0)? as usize;
        match (key, first_value(value)?) {
            (FORMAT_VIDEO_FORMAT, (TYPE_ID, body)) => format = VideoFormat::from_raw(word(body, 0)?),
            (FORMAT_VIDEO_SIZE, (TYPE_RECTANGLE, body)) => dims = Some((word(body, 0)?, word(body, 4)?)),
            (FORMAT_MEDIA_TYPE, (TYPE_ID, body)) if word(body, 0)? != MEDIA_TYPE_VIDEO => return None,
            _ => {}
        }
        at += 8 + (8 + value_size).next_multiple_of(8);
    }
    let (width, height) = dims?;
    (width > 0 && height > 0).then_some(Negotiated {
        format: format?,
        width,
        height,
    })
}
