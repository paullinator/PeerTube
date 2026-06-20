import { HttpStatusCode, VideoChannelInviteInfo, VideoChannelInviteRedeemResult } from '@peertube/peertube-models'
import { logger } from '@server/helpers/logger.js'
import { sequelizeTypescript } from '@server/initializers/database.js'
import { VideoChannelAllowedAccountModel } from '@server/models/video/video-channel-allowed-account.js'
import { VideoChannelModel } from '@server/models/video/video-channel.js'
import express from 'express'
import {
  apiRateLimiter,
  asyncMiddleware,
  asyncRetryTransactionMiddleware,
  authenticate,
  optionalAuthenticate,
  videoChannelInviteByCodeValidatorFactory
} from '../../middlewares/index.js'

const videoChannelInvitesRouter = express.Router()

videoChannelInvitesRouter.use(apiRateLimiter)

videoChannelInvitesRouter.get(
  '/:code',
  optionalAuthenticate,
  videoChannelInviteByCodeValidatorFactory({ requireRedeemable: false }),
  asyncMiddleware(getVideoChannelInviteInfo)
)

videoChannelInvitesRouter.post(
  '/:code/redeem',
  authenticate,
  videoChannelInviteByCodeValidatorFactory({ requireRedeemable: true }),
  asyncRetryTransactionMiddleware(redeemVideoChannelInvite)
)

// ---------------------------------------------------------------------------

export {
  videoChannelInvitesRouter
}

// ---------------------------------------------------------------------------

async function getVideoChannelInviteInfo (req: express.Request, res: express.Response) {
  const invite = res.locals.videoChannelInvite

  const channel = await VideoChannelModel.loadAndPopulateAccount(invite.channelId)
  if (!channel) {
    return res.fail({ status: HttpStatusCode.NOT_FOUND_404, message: 'Channel not found' })
  }

  return res.json({
    valid: invite.isRedeemable(),
    channel: {
      name: channel.Actor.preferredUsername,
      displayName: channel.name
    }
  } satisfies VideoChannelInviteInfo)
}

async function redeemVideoChannelInvite (req: express.Request, res: express.Response) {
  const invite = res.locals.videoChannelInvite
  const user = res.locals.oauth.token.User

  const channel = await VideoChannelModel.loadAndPopulateAccount(invite.channelId)
  if (!channel) {
    return res.fail({ status: HttpStatusCode.NOT_FOUND_404, message: 'Channel not found' })
  }

  const accountId = user.Account.id

  await sequelizeTypescript.transaction(async t => {
    const alreadyAllowed = await VideoChannelAllowedAccountModel.isAllowedForUser({ userId: user.id, channelId: channel.id })

    if (!alreadyAllowed) {
      await VideoChannelAllowedAccountModel.add(channel.id, accountId, t)
      await invite.incrementUses(t)
    }
  })

  logger.info('Account %d redeemed an invite for channel %s.', accountId, channel.Actor.url)

  return res.json({
    channelHandle: channel.Actor.preferredUsername
  } satisfies VideoChannelInviteRedeemResult)
}
