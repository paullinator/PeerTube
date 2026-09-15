import { HttpStatusCode, ServerErrorCode, UserRight, VideoHLSCopyFromSource } from '@peertube/peertube-models'
import { isBooleanValid, toBooleanOrNull } from '@server/helpers/custom-validators/misc.js'
import { CONFIG } from '@server/initializers/config.js'
import { buildUploadXFile, safeUploadXCleanup } from '@server/lib/uploadx.js'
import { VideoJobInfoModel } from '@server/models/video/video-job-info.js'
import { VideoSourceModel } from '@server/models/video/video-source.js'
import { Metadata as UploadXMetadata } from '@uploadx/core'
import express from 'express'
import { body, param } from 'express-validator'
import {
  areValidationErrors,
  checkCanAccessVideoSourceFile,
  checkCanManageVideo,
  doesVideoExist,
  isValidVideoIdParam
} from '../shared/index.js'
import { addDurationToVideoFileIfNeeded, checkVideoFileCanBeEdited, commonVideoFileChecks, isVideoFileAccepted } from './shared/index.js'
import { checkVideoCanBeTranscribedOrTranscoded } from './shared/video-validators.js'

export const videoSourceGetLatestValidator = [
  isValidVideoIdParam('id'),

  async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (areValidationErrors(req, res)) return
    if (!await doesVideoExist(req.params.id, res, 'with-rights')) return

    const video = res.locals.videoWithRights

    const user = res.locals.oauth.token.User
    if (!await checkCanManageVideo({ user, video, right: UserRight.UPDATE_ANY_VIDEO, req, res, checkIsLocal: true, checkIsOwner: false })) {
      return
    }

    res.locals.videoSource = await VideoSourceModel.loadLatest(video.id)

    if (!res.locals.videoSource) {
      return res.fail({
        status: HttpStatusCode.NOT_FOUND_404,
        message: req.t('Video source not found')
      })
    }

    return next()
  }
]

export const videoStoredFilesValidator = [
  isValidVideoIdParam('id'),

  async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (areValidationErrors(req, res)) return
    if (!await doesVideoExist(req.params.id, res, 'full')) return

    const video = res.locals.videoFull

    const user = res.locals.oauth.token.User
    if (!await checkCanManageVideo({ user, video, right: UserRight.UPDATE_ANY_VIDEO, req, res, checkIsLocal: true, checkIsOwner: false })) {
      return
    }

    // Can be null for videos uploaded before PeerTube tracked sources
    res.locals.videoSource = await VideoSourceModel.loadLatest(video.id)

    return next()
  }
]

export const videoHLSCopyFromSourceValidator = [
  isValidVideoIdParam('id'),

  body('force')
    .optional()
    .custom(isBooleanValid)
    .customSanitizer(toBooleanOrNull),

  async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (areValidationErrors(req, res)) return
    if (!await doesVideoExist(req.params.id, res, 'full')) return

    const video = res.locals.videoFull
    const body = req.body as VideoHLSCopyFromSource

    const user = res.locals.oauth.token.User
    if (!await checkCanManageVideo({ user, video, right: UserRight.UPDATE_ANY_VIDEO, req, res, checkIsLocal: true, checkIsOwner: false })) {
      return
    }

    if (!checkVideoCanBeTranscribedOrTranscoded({ video, req, res, skipStateCheck: body.force === true })) return

    if (CONFIG.TRANSCODING.ENABLED !== true || CONFIG.TRANSCODING.HLS.ENABLED !== true) {
      return res.fail({
        status: HttpStatusCode.BAD_REQUEST_400,
        message: req.t('Cannot copy the original file because HLS transcoding is disabled on this instance')
      })
    }

    const videoSource = await VideoSourceModel.loadLatest(video.id)
    if (!videoSource?.keptOriginalFilename) {
      return res.fail({
        status: HttpStatusCode.BAD_REQUEST_400,
        message: req.t('The original file of this video is not kept on this instance')
      })
    }

    if (body.force !== true) {
      const info = await VideoJobInfoModel.load(video.id)

      if (info && info.pendingTranscode > 0) {
        return res.fail({
          status: HttpStatusCode.CONFLICT_409,
          type: ServerErrorCode.VIDEO_ALREADY_BEING_TRANSCODED,
          message: req.t('This video is already being transcoded')
        })
      }
    }

    res.locals.videoSource = videoSource

    return next()
  }
]

export const replaceVideoSourceResumableValidator = [
  async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const file = buildUploadXFile(req.body as express.CustomUploadXFile<UploadXMetadata>)
    const cleanup = () => safeUploadXCleanup(file)

    if (!await checkCanUpdateVideoFile({ req, res })) {
      return cleanup()
    }

    if (!await addDurationToVideoFileIfNeeded({ videoFile: file, res, middlewareName: 'updateVideoFileResumableValidator' })) {
      return cleanup()
    }

    if (
      !await isVideoFileAccepted({
        req,
        res,
        videoFile: file,
        videoBody: file.metadata,
        hook: 'filter:api.video.update-file.accept.result'
      })
    ) {
      return cleanup()
    }

    res.locals.updateVideoFileResumable = { ...file, originalname: file.filename }

    return next()
  }
]

export const replaceVideoSourceResumableInitValidator = [
  async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!await checkCanUpdateVideoFile({ req, res })) return

    const fileMetadata = res.locals.uploadVideoFileResumableMetadata
    const files = { videofile: [ fileMetadata ] }
    const channelUser = { id: res.locals.videoFull.VideoChannel.Account.userId }

    if (await commonVideoFileChecks({ req, res, channelUser, videoFileSize: fileMetadata.size, files }) === false) return

    return next()
  }
]

export const originalVideoFileDownloadValidator = [
  param('filename').exists(),

  async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (areValidationErrors(req, res)) return

    const videoSource = await VideoSourceModel.loadByKeptOriginalFilename(req.params.filename)
    if (!videoSource) {
      return res.fail({
        status: HttpStatusCode.NOT_FOUND_404,
        message: req.t('Original video file not found')
      })
    }

    if (!await checkCanAccessVideoSourceFile({ req, res, videoId: videoSource.videoId })) return

    res.locals.videoSource = videoSource

    return next()
  }
]

// ---------------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------------

async function checkCanUpdateVideoFile (options: {
  req: express.Request
  res: express.Response
}) {
  const { req, res } = options

  if (!CONFIG.VIDEO_FILE.UPDATE.ENABLED) {
    res.fail({
      status: HttpStatusCode.FORBIDDEN_403,
      message: req.t('Updating the file of an existing video is not allowed on this instance')
    })
    return false
  }

  if (!await doesVideoExist(req.params.id, res)) return false

  const user = res.locals.oauth.token.User
  const video = res.locals.videoFull

  if (!await checkCanManageVideo({ user, video, right: UserRight.UPDATE_ANY_VIDEO, req, res, checkIsLocal: true, checkIsOwner: false })) {
    return false
  }

  if (!checkVideoFileCanBeEdited(video, req, res)) return false

  return true
}
