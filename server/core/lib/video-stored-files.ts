import { getResolutionLabel, toEven } from '@peertube/peertube-core-utils'
import { FileStorage, FileStorageType, HLSTranscodingPayload, VideoStoredFile, VideoStoredFileKind } from '@peertube/peertube-models'
import { JobQueue } from '@server/lib/job-queue/index.js'
import { VideoFileModel } from '@server/models/video/video-file.js'
import { VideoJobInfoModel } from '@server/models/video/video-job-info.js'
import { MVideoFile, MVideoFull } from '@server/types/models/index.js'
import { MVideoSource } from '@server/types/models/video/video-source.js'
import { getTranscodingJobPriority } from './transcoding/transcoding-priority.js'

// Every copy of the video stored by this instance: the kept original, HLS files and web video files
export async function listVideoStoredFiles (options: {
  video: MVideoFull
  videoSource: MVideoSource | null
}): Promise<VideoStoredFile[]> {
  const { video, videoSource } = options

  const result: VideoStoredFile[] = []

  if (videoSource?.keptOriginalFilename) {
    result.push({
      kind: 'original',
      id: null,
      filename: videoSource.keptOriginalFilename,
      storage: buildStorageLabel(videoSource.storage),
      resolution: buildResolution(videoSource),
      width: videoSource.width,
      height: videoSource.height,
      fps: videoSource.fps,
      size: videoSource.size,
      ...buildCodecInfo(videoSource.metadata),
      fileDownloadUrl: videoSource.getFileDownloadUrl(),
      createdAt: videoSource.createdAt
    })
  }

  for (const file of video.getHLSPlaylist()?.VideoFiles ?? []) {
    result.push(await buildFromVideoFile({ kind: 'hls', file, video }))
  }

  for (const file of video.VideoFiles ?? []) {
    result.push(await buildFromVideoFile({ kind: 'web-video', file, video }))
  }

  return result
}

export async function createHLSCopyFromOriginalJob (options: {
  video: MVideoFull
  videoSource: MVideoSource
}) {
  const { video, videoSource } = options

  const payload: HLSTranscodingPayload = {
    type: 'new-resolution-to-hls',
    videoUUID: video.uuid,
    resolution: toEven(videoSource.resolution),
    fps: videoSource.fps,
    isNewVideo: false,
    canMoveVideoState: true,
    separatedAudio: false,
    deleteWebVideoFiles: false,
    inputStreams: video.getStreamTypes(),
    transcodingRequestAt: new Date().toISOString(),
    fromOriginalFile: true
  }

  // Before creating the job, so a fast job cannot decrease the counter first
  await VideoJobInfoModel.increaseOrCreate(video.uuid, 'pendingTranscode')

  await JobQueue.Instance.createJob({
    type: 'video-transcoding',
    priority: await getTranscodingJobPriority({ user: null, type: 'vod-optional' }),
    payload
  })
}

// ---------------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------------

async function buildFromVideoFile (options: {
  kind: VideoStoredFileKind
  file: MVideoFile
  video: MVideoFull
}): Promise<VideoStoredFile> {
  const { kind, file, video } = options

  // The metadata column is not loaded with the video files
  const metadata = (await VideoFileModel.loadWithMetadata(file.id))?.metadata

  return {
    kind,
    id: file.id,
    filename: file.filename,
    storage: buildStorageLabel(file.storage),
    resolution: buildResolution(file),
    width: file.width,
    height: file.height,
    fps: file.fps,
    size: file.size,
    ...buildCodecInfo(metadata),
    fileDownloadUrl: file.getFileDownloadUrl(video),
    createdAt: file.createdAt
  }
}

function buildStorageLabel (storage: FileStorageType) {
  return storage === FileStorage.OBJECT_STORAGE
    ? 'object-storage'
    : 'file-system'
}

function buildResolution (file: { resolution: number, width: number, height: number }) {
  return {
    id: file.resolution,
    label: getResolutionLabel(file)
  }
}

function buildCodecInfo (metadata: { streams?: { codec_type?: string, codec_name?: string }[], format?: { bit_rate?: string | number } }) {
  const streams = metadata?.streams ?? []

  const bitrate = Number(metadata?.format?.bit_rate)

  return {
    videoCodec: streams.find(s => s.codec_type === 'video')?.codec_name ?? null,
    audioCodec: streams.find(s => s.codec_type === 'audio')?.codec_name ?? null,
    bitrate: Number.isFinite(bitrate) && bitrate > 0
      ? bitrate
      : null
  }
}
