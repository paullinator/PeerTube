import {
  HLSTranscodingPayload,
  MergeAudioTranscodingPayload,
  NewWebVideoResolutionTranscodingPayload,
  OptimizeTranscodingPayload,
  VideoResolution,
  VideoTranscodingPayload
} from '@peertube/peertube-models'
import { CONFIG } from '@server/initializers/config.js'
import { hasMissingHLSStreams } from '@server/lib/runners/job-handlers/shared/utils.js'
import { onTranscodingEnded } from '@server/lib/transcoding/ended-transcoding.js'
import { updateM3U8AndShaPlaylist } from '@server/lib/hls.js'
import { generateHlsPlaylistResolution } from '@server/lib/transcoding/hls-transcoding.js'
import { mergeAudioVideofile, optimizeOriginalVideofile, transcodeNewWebVideoResolution } from '@server/lib/transcoding/web-transcoding.js'
import { removeAllWebVideoFiles, removeHLSFile } from '@server/lib/video-file.js'
import { VideoPathManager } from '@server/lib/video-path-manager.js'
import { moveToFailedTranscodingState } from '@server/lib/video-state.js'
import { UserModel } from '@server/models/user/user.js'
import { VideoJobInfoModel } from '@server/models/video/video-job-info.js'
import { VideoSourceModel } from '@server/models/video/video-source.js'
import { MUser, MUserId, MVideoFull } from '@server/types/models/index.js'
import { Job } from 'bullmq'
import { logger, loggerTagsFactory } from '../../../helpers/logger.js'
import { VideoModel } from '../../../models/video/video.js'

type HandlerFunction = (job: Job, payload: VideoTranscodingPayload, video: MVideoFull, user: MUser) => Promise<void>

const handlers: { [id in VideoTranscodingPayload['type']]: HandlerFunction } = {
  'new-resolution-to-hls': handleHLSJob,
  'new-resolution-to-web-video': handleNewWebVideoResolutionJob,
  'merge-audio-to-web-video': handleWebVideoMergeAudioJob,
  'optimize-to-web-video': handleWebVideoOptimizeJob
}

const lTags = loggerTagsFactory('transcoding')

async function processVideoTranscoding (job: Job) {
  const payload = job.data as VideoTranscodingPayload
  logger.info('Processing transcoding job %s.', job.id, lTags(payload.videoUUID))

  const video = await VideoModel.loadFull(payload.videoUUID)
  // No video, maybe deleted?
  if (!video) {
    logger.info(`Do not process job ${job.id}, video does not exist.`, lTags(payload.videoUUID))
    return undefined
  }

  const user = await UserModel.loadByChannelActorId(video.VideoChannel.Actor.id)

  const handler = handlers[payload.type]

  if (!handler) {
    await moveToFailedTranscodingState(video)
    await VideoJobInfoModel.decrease(video.uuid, 'pendingTranscode')

    throw new Error('Cannot find transcoding handler for ' + payload.type)
  }

  try {
    await handler(job, payload, video, user)
  } catch (error) {
    await moveToFailedTranscodingState(video)

    await VideoJobInfoModel.decrease(video.uuid, 'pendingTranscode')

    throw error
  }

  return video
}

// ---------------------------------------------------------------------------

export {
  processVideoTranscoding
}

// ---------------------------------------------------------------------------
// Job handlers
// ---------------------------------------------------------------------------

async function handleWebVideoMergeAudioJob (job: Job, payload: MergeAudioTranscodingPayload, video: MVideoFull, user: MUserId) {
  logger.info('Handling merge audio transcoding job for %s.', video.uuid, lTags(video.uuid), { payload })

  await mergeAudioVideofile({ video, resolution: payload.resolution, fps: payload.fps, job })

  logger.info('Merge audio transcoding job for %s ended.', video.uuid, lTags(video.uuid), { payload })

  await onTranscodingEnded({ isNewVideo: payload.isNewVideo, moveVideoToNextState: payload.canMoveVideoState, video })
}

async function handleWebVideoOptimizeJob (job: Job, payload: OptimizeTranscodingPayload, video: MVideoFull, user: MUserId) {
  logger.info('Handling optimize transcoding job for %s.', video.uuid, lTags(video.uuid), { payload })

  await optimizeOriginalVideofile({ video, job })

  logger.info('Optimize transcoding job for %s ended.', video.uuid, lTags(video.uuid), { payload })

  await onTranscodingEnded({ isNewVideo: payload.isNewVideo, moveVideoToNextState: payload.canMoveVideoState, video })
}

// ---------------------------------------------------------------------------

async function handleNewWebVideoResolutionJob (job: Job, payload: NewWebVideoResolutionTranscodingPayload, video: MVideoFull) {
  logger.info('Handling Web Video transcoding job for %s.', video.uuid, lTags(video.uuid), { payload })

  await transcodeNewWebVideoResolution({ video, resolution: payload.resolution, fps: payload.fps, job })

  logger.info('Web Video transcoding job for %s ended.', video.uuid, lTags(video.uuid), { payload })

  // Always move video to next state, we're ready enough with this resolution
  await onTranscodingEnded({ isNewVideo: payload.isNewVideo, moveVideoToNextState: payload.canMoveVideoState, video })
}

// ---------------------------------------------------------------------------

async function handleHLSCopyFromOriginalJob (job: Job, payload: HLSTranscodingPayload, videoArg: MVideoFull) {
  logger.info('Handling HLS copy of the original file job for %s.', videoArg.uuid, lTags(videoArg.uuid), { payload })

  const inputFileMutexReleaser = await VideoPathManager.Instance.lockFiles(videoArg.uuid)
  let video: MVideoFull

  try {
    video = await VideoModel.loadFull(videoArg.uuid)

    const videoSource = await VideoSourceModel.loadLatest(video.id)
    if (!videoSource?.keptOriginalFilename) {
      throw new Error(`Cannot copy the original file of ${video.uuid} because it is not kept`)
    }

    await VideoPathManager.Instance.makeAvailableOriginalFile(videoSource, originalPath => {
      return generateHlsPlaylistResolution({
        video,
        videoInputPath: originalPath,
        separatedAudioInputPath: undefined,
        inputFileMutexReleaser,
        resolution: payload.resolution,
        fps: payload.fps,
        separatedAudio: false,
        forceCopyCodecs: true,
        job
      })
    })
  } finally {
    inputFileMutexReleaser()
  }

  // The copy is now the only file served
  video = await VideoModel.loadFull(videoArg.uuid)
  const copiedFileId = video.getHLSPlaylist()?.VideoFiles.find(f => f.resolution === payload.resolution)?.id

  if (copiedFileId) {
    const otherHLSFileIds = video.getHLSPlaylist().VideoFiles
      .filter(f => f.id !== copiedFileId)
      .map(f => f.id)

    for (const fileId of otherHLSFileIds) {
      await removeHLSFile(video, fileId)
      video = await VideoModel.loadFull(videoArg.uuid)
    }

    // Otherwise the master playlist still lists the removed resolutions and players fail to load them
    if (otherHLSFileIds.length !== 0) {
      await updateM3U8AndShaPlaylist(video, video.getHLSPlaylist())
      video = await VideoModel.loadFull(videoArg.uuid)
    }

    if (video.VideoFiles.length !== 0) {
      logger.info('Removing Web Video files of %s now we have a HLS copy of the original file.', video.uuid, lTags(video.uuid))

      await removeAllWebVideoFiles(video)
    }
  }

  logger.info('HLS copy of the original file job for %s ended.', video.uuid, lTags(video.uuid), { payload })

  await onTranscodingEnded({ isNewVideo: payload.isNewVideo, moveVideoToNextState: payload.canMoveVideoState, video })
}

async function handleHLSJob (job: Job, payload: HLSTranscodingPayload, videoArg: MVideoFull) {
  if (payload.fromOriginalFile === true) return handleHLSCopyFromOriginalJob(job, payload, videoArg)

  logger.info('Handling HLS transcoding job for %s.', videoArg.uuid, lTags(videoArg.uuid), { payload })

  const inputFileMutexReleaser = await VideoPathManager.Instance.lockFiles(videoArg.uuid)
  let video: MVideoFull

  try {
    video = await VideoModel.loadFull(videoArg.uuid)

    const { videoFile, separatedAudioFile } = video.getMaxQualityAudioAndVideoFiles()
    const webVideoFile = video.getWebVideoFileResolution(payload.resolution)

    const videoFileInputs = webVideoFile
      ? [ webVideoFile ]
      : [ videoFile, separatedAudioFile ].filter(v => !!v)

    await VideoPathManager.Instance.makeAvailableVideoFiles(videoFileInputs, ([ videoPath, separatedAudioPath ]) => {
      return generateHlsPlaylistResolution({
        video,

        videoInputPath: videoPath,
        separatedAudioInputPath: separatedAudioPath,

        inputFileMutexReleaser,
        resolution: payload.resolution,
        fps: payload.fps,
        separatedAudio: payload.separatedAudio,
        job
      })
    })
  } finally {
    inputFileMutexReleaser()
  }

  logger.info('HLS transcoding job for %s ended.', video.uuid, lTags(video.uuid), { payload })

  const missingStream = await hasMissingHLSStreams({
    inputStreams: payload.inputStreams,
    transcodingRequestAt: payload.transcodingRequestAt,
    videoId: videoArg.uuid
  })

  if (!missingStream && payload.deleteWebVideoFiles === true) {
    const resolutionExceptions = CONFIG.TRANSCODING.ALWAYS_TRANSCODE_PODCAST_OPTIMIZED_AUDIO
      ? [ VideoResolution.H_NOVIDEO ]
      : []

    logger.info('Removing Web Video files of %s now we have a HLS version of it.', video.uuid, {
      resolutionExceptions,
      ...lTags(video.uuid)
    })

    await removeAllWebVideoFiles(video, { resolutionExceptions })
  }

  // Splitted audio, wait audio & video generation before moving the video in its next state
  const moveVideoToNextState = payload.canMoveVideoState && !missingStream

  await onTranscodingEnded({ isNewVideo: payload.isNewVideo, moveVideoToNextState, video })
}
