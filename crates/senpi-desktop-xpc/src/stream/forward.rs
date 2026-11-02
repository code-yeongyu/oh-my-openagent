use std::{future::Future, io};
use tokio::io::{AsyncWrite, AsyncWriteExt};

/// Bridge approved frames into the engine's NDJSON router. The output half
/// remains live, so dropping this split write half cannot substitute for EOF.
pub async fn forward_frames<W, Next, Frame>(
    mut writer: W,
    mut next: Next,
    accept: impl Fn(&[u8]) -> bool,
) -> io::Result<()>
where
    W: AsyncWrite + Unpin,
    Next: FnMut() -> Frame,
    Frame: Future<Output = Option<Vec<u8>>>,
{
    let transferred = async {
        while let Some(frame) = next().await {
            if !accept(&frame) {
                break;
            }
            writer.write_all(&frame).await?;
            writer.write_all(b"\n").await?;
        }
        Ok(())
    }
    .await;
    let closed = writer.shutdown().await;
    transferred.and(closed)
}
