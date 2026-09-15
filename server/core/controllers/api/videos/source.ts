import { buildAspectRatio } from '@peertube/peertube-core-utils'
import { HttpStatusCode, VideoChannelActivityAction, VideoState } from '@peertube/peertube-models'
import { sequelizeTypescript } from '@server/initializers/database.js'
import { CreateJobOptions, CreateJobTypeAndPayload, JobQueue } from '@server/lib/job-queue/index.js'
import { Hooks } from '@server/lib/plugins/hooks.js'
import { regenerateLocalVideoThumbnailsFromVideoIfNeeded } from '@server/lib/thumbnail.js'
import { setupUploadResumableRoutes } from '@server/lib/uploadx.js'
import { autoBlacklistVideoIfNeeded } from '@server/lib/video-blacklist.js'
import { regenerateTranscriptionTaskIfNeeded } from '@server/lib/video-captions.js'
import { buildNewFile, createVideoSource } from '@server/lib/video-file.js'
import { addRemoteStoryboardJobIfNeeded, buildLocalStoryboardJobIfNeeded, buildMoveVideoJob } from '@server/lib/video-jobs.js'
import { VideoPathManager } from '@server/lib/video-path-manager.js'
import { buildNextVideoState } from '@server/lib/video-state.js'
import { createHLSCopyFromOriginalJob, listVideoStoredFiles } from '@server/lib/video-stored-files.js'
import { openapiOperationDoc } from '@server/middlewares/doc.js'
import { VideoChannelActivityModel } from '@server/models/video/video-channel-activity.js'
import { VideoJobInfoModel } from '@server/models/video/video-job-info.js'
import { VideoModel } from '@server/models/video/video.js'
import { MStreamingPlaylistFiles, MVideo, MVideoFile, MVideoFull } from '@server/types/models/index.js'
import express from 'express'
import { move } from 'fs-extra/esm'
import { logger, loggerTagsFactory } from '../../../helpers/logger.js'
import {
  asyncMiddleware,
  authenticate,
  replaceVideoSourceResumableInitValidator,
  replaceVideoSourceResumableValidator,
  videoHLSCopyFromSourceValidator,
  videoSourceGetLatestValidator,
  videoStoredFilesValidator
} from '../../../middlewares/index.js'

const lTags = loggerTagsFactory('api', 'video')

const videoSourceRouter = express.Router()

videoSourceRouter.get(
  '/:id/source',
  openapiOperationDoc({ operationId: 'getVideoSource' }),
  authenticate,
  asyncMiddleware(videoSourceGetLatestValidator),
  getVideoLatestSource
)

videoSourceRouter.delete(
  '/:id/source/file',
  openapiOperationDoc({ operationId: 'deleteVideoSourceFile' }),
  authenticate,
  asyncMiddleware(videoSourceGetLatestValidator),
  asyncMiddleware(deleteVideoLatestSourceFile)
)

videoSourceRouter.post(
  '/:id/source/hls-copy',
  openapiOperationDoc({ operationId: 'createVideoHLSCopyFromSource' }),
  authenticate,
  asyncMiddleware(videoHLSCopyFromSourceValidator),
  asyncMiddleware(createHLSCopyFromSource)
)

videoSourceRouter.get(
  '/:id/stored-files',
  openapiOperationDoc({ operationId: 'getVideoStoredFiles' }),
  authenticate,
  asyncMiddleware(videoStoredFilesValidator),
  asyncMiddleware(getVideoStoredFiles)
)

setupUploadResumableRoutes({
  routePath: '/:id/source/replace-resumable',
  router: videoSourceRouter,

  uploadInitAfterMiddlewares: [ asyncMiddleware(replaceVideoSourceResumableInitValidator) ],
  uploadedMiddlewares: [ asyncMiddleware(replaceVideoSourceResumableValidator) ],
  uploadedController: asyncMiddleware(replaceVideoSourceResumable)
})

// ---------------------------------------------------------------------------

export {
  videoSourceRouter
}

// ---------------------------------------------------------------------------

async function deleteVideoLatestSourceFile (req: express.Request, res: express.Response) {
  const videoSource = res.locals.videoSource
  const video = res.locals.videoWithRights

  await video.removeOriginalFile(videoSource)

  videoSource.keptOriginalFilename = null
  videoSource.storage = null

  await videoSource.save()

  await VideoChannelActivityModel.addVideoActivity({
    action: VideoChannelActivityAction.UPDATE_SOURCE_FILE,
    user: res.locals.oauth.token.User,
    channel: video.VideoChannel,
    video,
    transaction: null
  })

  return res.sendStatus(HttpStatusCode.NO_CONTENT_204)
}

function getVideoLatestSource (req: express.Request, res: express.Response) {
  return res.json(res.locals.videoSource.toFormattedJSON())
}

async function getVideoStoredFiles (req: express.Request, res: express.Response) {
  return res.json(await listVideoStoredFiles({ video: res.locals.videoFull, videoSource: res.locals.videoSource }))
}

async function createHLSCopyFromSource (req: express.Request, res: express.Response) {
  const video = res.locals.videoFull

  logger.info('Creating HLS copy of the original file of %s.', video.url, lTags(video.uuid))

  await VideoJobInfoModel.abortAllTasks(video.uuid, 'pendingTranscode')

  video.state = VideoState.TO_TRANSCODE
  await video.save()

  await createHLSCopyFromOriginalJob({ video, videoSource: res.locals.videoSource })

  return res.sendStatus(HttpStatusCode.NO_CONTENT_204)
}

async function replaceVideoSourceResumable (req: express.Request, res: express.Response) {
  const videoPhysicalFile = res.locals.updateVideoFileResumable
  const user = res.locals.oauth.token.User

  const videoFile = await buildNewFile({ path: videoPhysicalFile.path, mode: 'web-video', ffprobe: res.locals.ffprobe })
  const originalFilename = videoPhysicalFile.originalname

  const videoFileMutexReleaser = await VideoPathManager.Instance.lockFiles(res.locals.videoFull.uuid)

  try {
    const destination = VideoPathManager.Instance.getFSVideoFileOutputPath(res.locals.videoFull, videoFile)
    await move(videoPhysicalFile.path, destination)

    let oldWebVideoFiles: MVideoFile[] = []
    let oldStreamingPlaylists: MStreamingPlaylistFiles[] = []

    const inputFileUpdatedAt = new Date()

    const video = await sequelizeTypescript.transaction(async transaction => {
      const video = await VideoModel.loadFull(res.locals.videoFull.id, transaction)

      oldWebVideoFiles = video.VideoFiles
      oldStreamingPlaylists = video.VideoStreamingPlaylists

      for (const file of video.VideoFiles) {
        await file.destroy({ transaction })
      }
      for (const playlist of oldStreamingPlaylists) {
        await playlist.destroy({ transaction })
      }

      videoFile.videoId = video.id
      await videoFile.save({ transaction })

      video.VideoFiles = [ videoFile ]
      video.VideoStreamingPlaylists = []

      video.state = buildNextVideoState()
      video.duration = videoPhysicalFile.duration
      video.inputFileUpdatedAt = inputFileUpdatedAt
      video.aspectRatio = buildAspectRatio({ width: videoFile.width, height: videoFile.height })
      await video.save({ transaction })

      await autoBlacklistVideoIfNeeded({
        video,
        user,
        isRemote: false,
        isNew: false,
        isNewFile: true,
        transaction
      })

      await VideoChannelActivityModel.addVideoActivity({
        action: VideoChannelActivityAction.UPDATE_SOURCE_FILE,
        user,
        channel: video.VideoChannel,
        video,
        transaction
      })

      return video
    })

    await removeOldFiles({ video, files: oldWebVideoFiles, playlists: oldStreamingPlaylists })

    const source = await createVideoSource({
      inputFilename: originalFilename,
      inputProbe: res.locals.ffprobe,
      inputPath: destination,
      video,
      createdAt: inputFileUpdatedAt
    })

    await regenerateLocalVideoThumbnailsFromVideoIfNeeded(video, res.locals.ffprobe)
    await video.VideoChannel.setAsUpdated()

    await addVideoJobsAfterUpload(video, videoFile.withVideoOrPlaylist(video))

    logger.info('Replaced video file of video %s with uuid %s.', video.name, video.uuid, lTags(video.uuid))

    Hooks.runAction('action:api.video.file-updated', { video, req, res })

    return res.json(source.toFormattedJSON())
  } finally {
    videoFileMutexReleaser()
  }
}

async function addVideoJobsAfterUpload (video: MVideoFull, videoFile: MVideoFile) {
  const jobs: (CreateJobTypeAndPayload & CreateJobOptions)[] = [
    {
      type: 'manage-video-torrent' as const,
      payload: {
        videoId: video.id,
        videoFileId: videoFile.id,
        action: 'create'
      }
    },

    await buildLocalStoryboardJobIfNeeded({ video, federate: false }),

    {
      type: 'federate-video' as const,
      payload: {
        videoUUID: video.uuid,
        isNewVideoForFederation: false
      }
    }
  ]

  if (video.state === VideoState.TO_MOVE_TO_EXTERNAL_STORAGE) {
    jobs.push(
      await buildMoveVideoJob({
        type: 'move-to-object-storage',
        video,
        moveVideoState: {
          isNewVideo: false,
          previousVideoState: undefined
        }
      })
    )
  }

  if (video.state === VideoState.TO_TRANSCODE) {
    jobs.push({
      type: 'transcoding-job-builder' as const,
      payload: {
        videoUUID: video.uuid,
        optimizeJob: {
          isNewVideo: false
        }
      }
    })
  }

  await JobQueue.Instance.createSequentialJobFlow(...jobs)

  await addRemoteStoryboardJobIfNeeded(video)
  await regenerateTranscriptionTaskIfNeeded(video)
}

async function removeOldFiles (options: {
  video: MVideo
  files: MVideoFile[]
  playlists: MStreamingPlaylistFiles[]
}) {
  const { video, files, playlists } = options

  for (const file of files) {
    await video.removeWebVideoFile(file)
  }

  for (const playlist of playlists) {
    await video.removeAllStreamingPlaylistFiles({ playlist })
  }
}
