import { FileHandle, open } from 'fs/promises'

// Boxes on the path from moov to the sample tables
const CONTAINER_BOXES = new Set([ 'moov', 'trak', 'mdia', 'minf', 'stbl' ])

// An init segment is a few KB, don't load a larger moov
const MAX_MOOV_SIZE = 64 * 1024 * 1024

// FFmpeg before 8.0 writes an sdtp box with no entries in the moov of fragmented MP4 muxed from video with disposable
// (non-reference) frames, like HEVC with B-frames. Apple's player refuses such a file (CoreMedia -12848).
// Rename these boxes to "free" in place: the box keeps its size so HLS byte ranges and segment hashes stay valid.
// Returns the number of boxes renamed
export async function neutralizeEmptySdtpBoxes (path: string) {
  const handle = await open(path, 'r+')

  try {
    const moov = await findTopLevelBox(handle, 'moov')
    if (!moov || moov.size > MAX_MOOV_SIZE) return 0

    const buffer = Buffer.alloc(moov.size)
    await handle.read(buffer, 0, moov.size, moov.offset)

    const emptySdtpOffsets: number[] = []
    findEmptySdtpBoxes(buffer, moov.headerSize, moov.size, emptySdtpOffsets)

    for (const offset of emptySdtpOffsets) {
      await handle.write(Buffer.from('free', 'latin1'), 0, 4, moov.offset + offset + 4)
    }

    return emptySdtpOffsets.length
  } finally {
    await handle.close()
  }
}

// ---------------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------------

function parseBoxHeader (buffer: Buffer, offset: number, available: number) {
  if (available < 8) return undefined

  let size = buffer.readUInt32BE(offset)
  const type = buffer.toString('latin1', offset + 4, offset + 8)
  let headerSize = 8

  if (size === 1) {
    if (available < 16) return undefined

    size = Number(buffer.readBigUInt64BE(offset + 8))
    headerSize = 16
  }

  return { size, type, headerSize }
}

async function findTopLevelBox (handle: FileHandle, wantedType: string) {
  const fileSize = (await handle.stat()).size
  const header = Buffer.alloc(16)
  let offset = 0

  while (offset + 8 <= fileSize) {
    const { bytesRead } = await handle.read(header, 0, 16, offset)
    const box = parseBoxHeader(header, 0, bytesRead)
    if (!box) return undefined

    // Size 0 means the box extends to the end of the file
    const size = box.size === 0 ? fileSize - offset : box.size
    if (size < box.headerSize || offset + size > fileSize) return undefined

    if (box.type === wantedType) return { offset, size, headerSize: box.headerSize }

    offset += size
  }

  return undefined
}

function findEmptySdtpBoxes (buffer: Buffer, start: number, end: number, result: number[]) {
  let offset = start

  while (offset < end) {
    const box = parseBoxHeader(buffer, offset, end - offset)
    if (!box) return

    const size = box.size === 0 ? end - offset : box.size
    if (size < box.headerSize || offset + size > end) return

    // 8 bytes of box header and 4 bytes of version and flags, followed by no sample entries
    if (box.type === 'sdtp' && size === 12) result.push(offset)

    if (CONTAINER_BOXES.has(box.type)) findEmptySdtpBoxes(buffer, offset + box.headerSize, offset + size, result)

    offset += size
  }
}
