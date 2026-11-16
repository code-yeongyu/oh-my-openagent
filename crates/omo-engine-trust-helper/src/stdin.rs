//! Bun's bundled roots `B` arrive on stdin as DER certificates back to back (design 4.2 item 5).

use std::io::Read;

/// Bun's compiled-in roots are about 150 certificates; 8 MiB leaves room without trusting an unbounded pipe.
pub const STDIN_LIMIT: usize = 8 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub enum StdinError {
    Oversize,
    Unreadable,
    /// Not a sequence of definite-length, minimally encoded DER SEQUENCEs.
    Malformed,
}

pub fn read_bounded(reader: &mut impl Read, limit: usize) -> Result<Vec<u8>, StdinError> {
    let mut bytes = Vec::new();
    reader
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| StdinError::Unreadable)?;
    if bytes.len() > limit {
        return Err(StdinError::Oversize);
    }
    Ok(bytes)
}

/// Splits concatenated DER SEQUENCEs. Crypt32 later parses each one as a certificate.
pub fn split_der_list(bytes: &[u8]) -> Result<Vec<&[u8]>, StdinError> {
    let mut out = Vec::new();
    let mut rest = bytes;
    while !rest.is_empty() {
        if rest[0] != 0x30 || rest.len() < 2 {
            return Err(StdinError::Malformed);
        }
        let first = rest[1];
        let (header, length) = if first < 0x80 {
            (2, usize::from(first))
        } else {
            let count = usize::from(first & 0x7f);
            if count == 0 || count > 4 || rest.len() < 2 + count || rest[2] == 0 {
                return Err(StdinError::Malformed);
            }
            let length = rest[2..2 + count].iter().fold(0usize, |value, byte| (value << 8) | usize::from(*byte));
            if length < 0x80 {
                return Err(StdinError::Malformed);
            }
            (2 + count, length)
        };
        let end = header.checked_add(length).ok_or(StdinError::Malformed)?;
        if end > rest.len() {
            return Err(StdinError::Malformed);
        }
        out.push(&rest[..end]);
        rest = &rest[end..];
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concatenated_sequences_split_in_order() {
        let long = [&[0x30, 0x81, 0x80][..], &[0u8; 0x80][..]].concat();
        let bytes = [&[0x30, 0x00][..], &long, &[0x30, 0x01, 0x05][..]].concat();
        assert_eq!(split_der_list(&bytes), Ok(vec![&[0x30, 0x00][..], &long[..], &[0x30, 0x01, 0x05][..]]));
        assert_eq!(split_der_list(&[]), Ok(vec![]));
    }

    #[test]
    fn malformed_lists_are_refused() {
        for bytes in [
            &[0x31, 0x00][..],             // not a SEQUENCE
            &[0x30][..],                   // no length
            &[0x30, 0x02, 0x00][..],       // truncated
            &[0x30, 0x80, 0x00, 0x00][..], // indefinite length
            &[0x30, 0x81, 0x05, 0, 0, 0, 0, 0][..], // non-minimal length
            &[0x30, 0x82, 0x00, 0x80][..], // leading zero length byte
        ] {
            assert_eq!(split_der_list(bytes), Err(StdinError::Malformed), "{bytes:02x?}");
        }
    }

    #[test]
    fn stdin_over_the_bound_is_refused() {
        assert_eq!(read_bounded(&mut &[1u8, 2, 3][..], 3), Ok(vec![1, 2, 3]));
        assert_eq!(read_bounded(&mut &[1u8, 2, 3, 4][..], 3), Err(StdinError::Oversize));
    }
}
