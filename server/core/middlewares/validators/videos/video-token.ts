import express from 'express'
import { HttpStatusCode, VideoPrivacy } from '@peertube/peertube-models'
import { exists } from '@server/helpers/custom-validators/misc.js'
import { getAuthUser } from '@server/helpers/express-utils.js'
import { VideoChannelAccessModel } from '@server/models/video/video-channel-access.js'
import { checkCanSeeVideoChannelGate } from '../shared/videos.js'

export const videoFileTokenValidator = [
  async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const video = res.locals.videoWithBlacklist

    // Minting a file token for a video of a restricted channel requires proven access
    // (password header/cookie or allow-listed account). Fails with CHANNEL_REQUIRES_PASSWORD
    // / CHANNEL_ACCESS_DENIED otherwise so the client can prompt at playback time.
    if (!await checkCanSeeVideoChannelGate({ req, res, video, hasVideoFileToken: false })) return

    // CHANNEL-privacy videos always require a token but are authorized purely by the channel gate
    // above (public channel => anyone, restricted => proven access), so anonymous minting is allowed.
    if (
      video.privacy !== VideoPrivacy.PASSWORD_PROTECTED &&
      video.privacy !== VideoPrivacy.CHANNEL &&
      !exists(getAuthUser(res))
    ) {
      // Anonymous viewers that proved restricted-channel access (above) are allowed to mint
      // a file token for the channel's videos; everyone else must be authenticated.
      if (!await VideoChannelAccessModel.isRestricted(video.channelId)) {
        return res.sendStatus(HttpStatusCode.UNAUTHORIZED_401)
      }
    }

    return next()
  }
]
