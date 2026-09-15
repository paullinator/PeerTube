export type VideoStoredFileKind = 'original' | 'hls' | 'web-video'

export interface VideoStoredFile {
  kind: VideoStoredFileKind

  // Video file id, null for the original file
  id: number | null

  filename: string
  storage: 'file-system' | 'object-storage'

  resolution: {
    id: number
    label: string
  }

  width: number
  height: number
  fps: number
  size: number

  // From the ffprobe metadata stored with the file
  videoCodec: string | null
  audioCodec: string | null
  bitrate: number | null

  fileDownloadUrl: string | null

  createdAt: Date | string
}

export interface VideoHLSCopyFromSource {
  // Run even if a transcoding job is pending or the video state would prevent it
  force?: boolean
}
