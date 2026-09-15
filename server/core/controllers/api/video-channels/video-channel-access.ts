import {
  HttpStatusCode,
  VideoChannelAccess,
  VideoChannelAccessMode,
  VideoChannelAccessUpdate
} from '@peertube/peertube-models'
import { logger } from '@server/helpers/logger.js'
import { WEBSERVER } from '@server/initializers/constants.js'
import { sequelizeTypescript } from '@server/initializers/database.js'
import { generateChannelTokenSecret, grantChannelAccess } from '@server/lib/video-channel-access.js'
import { federateAllVideosOfChannel, unfederateAllVideosOfChannel } from '@server/lib/video-channel.js'
import { VideoChannelAccessModel } from '@server/models/video/video-channel-access.js'
import { VideoChannelAllowedAccountModel } from '@server/models/video/video-channel-allowed-account.js'
import { VideoChannelInviteModel } from '@server/models/video/video-channel-invite.js'
import { VideoChannelPasswordModel } from '@server/models/video/video-channel-password.js'
import express from 'express'
import {
  asyncMiddleware,
  asyncRetryTransactionMiddleware,
  authenticate,
  createVideoChannelInviteValidator,
  optionalAuthenticate,
  removeVideoChannelInviteValidator,
  requestVideoChannelAccessValidator,
  updateVideoChannelAccessValidator,
  videoChannelsHandleValidatorFactory
} from '../../../middlewares/index.js'

const videoChannelAccessRouter = express.Router()

videoChannelAccessRouter.get(
  '/:handle/access',
  authenticate,
  asyncMiddleware(videoChannelsHandleValidatorFactory({ checkIsLocal: true, checkCanManage: true, checkIsOwner: false })),
  asyncMiddleware(getVideoChannelAccess)
)

videoChannelAccessRouter.put(
  '/:handle/access',
  authenticate,
  asyncMiddleware(videoChannelsHandleValidatorFactory({ checkIsLocal: true, checkCanManage: true, checkIsOwner: false })),
  updateVideoChannelAccessValidator,
  asyncRetryTransactionMiddleware(updateVideoChannelAccess)
)

videoChannelAccessRouter.post(
  '/:handle/access/rotate',
  authenticate,
  asyncMiddleware(videoChannelsHandleValidatorFactory({ checkIsLocal: true, checkCanManage: true, checkIsOwner: false })),
  asyncRetryTransactionMiddleware(rotateVideoChannelAccess)
)

// Public: a viewer submits a password (or relies on their allow-listed account) to unlock the channel
videoChannelAccessRouter.post(
  '/:handle/access/request',
  optionalAuthenticate,
  asyncMiddleware(videoChannelsHandleValidatorFactory({ checkIsLocal: true, checkCanManage: false, checkIsOwner: false })),
  requestVideoChannelAccessValidator,
  asyncMiddleware(requestVideoChannelAccess)
)

// ---------------------------------------------------------------------------
// Invite links (owner/collaborator/admin)
// ---------------------------------------------------------------------------

videoChannelAccessRouter.get(
  '/:handle/invites',
  authenticate,
  asyncMiddleware(videoChannelsHandleValidatorFactory({ checkIsLocal: true, checkCanManage: true, checkIsOwner: false })),
  asyncMiddleware(listVideoChannelInvites)
)

videoChannelAccessRouter.post(
  '/:handle/invites',
  authenticate,
  asyncMiddleware(videoChannelsHandleValidatorFactory({ checkIsLocal: true, checkCanManage: true, checkIsOwner: false })),
  createVideoChannelInviteValidator,
  asyncMiddleware(createVideoChannelInvite)
)

videoChannelAccessRouter.delete(
  '/:handle/invites/:inviteId',
  authenticate,
  asyncMiddleware(videoChannelsHandleValidatorFactory({ checkIsLocal: true, checkCanManage: true, checkIsOwner: false })),
  asyncMiddleware(removeVideoChannelInviteValidator),
  asyncMiddleware(removeVideoChannelInvite)
)

// ---------------------------------------------------------------------------

export {
  videoChannelAccessRouter
}

// ---------------------------------------------------------------------------

async function getVideoChannelAccess (req: express.Request, res: express.Response) {
  const channel = res.locals.videoChannel

  const access = await VideoChannelAccessModel.loadByChannelId(channel.id)
  const passwords = await VideoChannelPasswordModel.listAllForChannel(channel.id)
  const allowedAccounts = await VideoChannelAllowedAccountModel.listForChannel(channel.id)

  return res.json({
    mode: access?.mode ?? VideoChannelAccessMode.PUBLIC,
    passwords: passwords.map(p => p.toFormattedJSON()),
    allowedAccounts: allowedAccounts.map(a => a.Account.toFormattedSummaryJSON())
  } satisfies VideoChannelAccess)
}

async function updateVideoChannelAccess (req: express.Request, res: express.Response) {
  const channel = res.locals.videoChannel
  const body = req.body as VideoChannelAccessUpdate
  const allowedAccountIds = res.locals.allowedAccountIds || []

  const previous = await VideoChannelAccessModel.loadByChannelId(channel.id)
  const wasRestricted = previous?.mode === VideoChannelAccessMode.RESTRICTED
  const willBeRestricted = body.mode === VideoChannelAccessMode.RESTRICTED

  await sequelizeTypescript.transaction(async t => {
    if (previous) {
      previous.mode = body.mode
      await previous.save({ transaction: t })
    } else {
      await VideoChannelAccessModel.create({
        channelId: channel.id,
        mode: body.mode,
        tokenSecret: generateChannelTokenSecret()
      }, { transaction: t })
    }

    if (willBeRestricted) {
      if (Array.isArray(body.passwords)) {
        await VideoChannelPasswordModel.deleteAllPasswords(channel.id, t)
        await VideoChannelPasswordModel.addPasswords(body.passwords, channel.id, t)
      }

      await VideoChannelAllowedAccountModel.deleteAllForChannel(channel.id, t)
      for (const accountId of allowedAccountIds) {
        await VideoChannelAllowedAccountModel.add(channel.id, accountId, t)
      }
    } else {
      // Going public: drop secrets and allow-list
      await VideoChannelPasswordModel.deleteAllPasswords(channel.id, t)
      await VideoChannelAllowedAccountModel.deleteAllForChannel(channel.id, t)
    }
  })

  logger.info('Channel access for %s updated (mode %d).', channel.Actor.url, body.mode)

  res.type('json').status(HttpStatusCode.NO_CONTENT_204).end()

  // Federation changes can be long: run them after the response, outside the transaction
  if (!wasRestricted && willBeRestricted) {
    await unfederateAllVideosOfChannel(channel)
  } else if (wasRestricted && !willBeRestricted) {
    await federateAllVideosOfChannel(channel)
  }
}

// Rotate the per-channel secret, invalidating every previously issued access cookie/token
async function rotateVideoChannelAccess (req: express.Request, res: express.Response) {
  const channel = res.locals.videoChannel

  const access = await VideoChannelAccessModel.loadByChannelId(channel.id)
  if (access) {
    access.tokenSecret = generateChannelTokenSecret()
    await access.save()
  }

  logger.info('Channel access secret for %s rotated.', channel.Actor.url)

  return res.sendStatus(HttpStatusCode.NO_CONTENT_204)
}

async function requestVideoChannelAccess (req: express.Request, res: express.Response) {
  const channel = res.locals.videoChannel
  const access = await VideoChannelAccessModel.loadByChannelId(channel.id)

  // Public channel: nothing to unlock
  if (!access || access.mode !== VideoChannelAccessMode.RESTRICTED) {
    return res.json({ success: true })
  }

  const user = res.locals.oauth?.token.User

  // Allow-listed account
  if (user && await VideoChannelAllowedAccountModel.isAllowedForUser({ userId: user.id, channelId: channel.id })) {
    grantChannelAccess(res, channel.id, access.tokenSecret)
    return res.json({ success: true })
  }

  // Password
  const password = req.body.password as string
  if (password && await VideoChannelPasswordModel.isACorrectPassword({ channelId: channel.id, password })) {
    grantChannelAccess(res, channel.id, access.tokenSecret)
    return res.json({ success: true })
  }

  return res.json({ success: false })
}

// ---------------------------------------------------------------------------
// Invite links
// ---------------------------------------------------------------------------

function formatInvite (invite: { id: number, code: string, channelId: number, maxUses: number, uses: number, expiresAt: Date }) {
  return {
    id: invite.id,
    code: invite.code,
    channelId: invite.channelId,
    maxUses: invite.maxUses ?? null,
    uses: invite.uses,
    expiresAt: invite.expiresAt ?? null,
    url: WEBSERVER.URL + '/i/' + invite.code
  }
}

async function listVideoChannelInvites (req: express.Request, res: express.Response) {
  const channel = res.locals.videoChannel

  const invites = await VideoChannelInviteModel.listForChannel(channel.id)

  return res.json({
    total: invites.length,
    data: invites.map(i => formatInvite(i))
  })
}

async function createVideoChannelInvite (req: express.Request, res: express.Response) {
  const channel = res.locals.videoChannel
  const body = req.body as { code: string, maxUses?: number | null, expiresAt?: string | null }

  const invite = await VideoChannelInviteModel.create({
    code: body.code,
    channelId: channel.id,
    maxUses: body.maxUses ?? null,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null
  })

  logger.info('Invite link created for channel %s.', channel.Actor.url)

  return res.json(formatInvite(invite))
}

async function removeVideoChannelInvite (req: express.Request, res: express.Response) {
  const invite = res.locals.videoChannelInvite

  await invite.destroy()

  return res.sendStatus(HttpStatusCode.NO_CONTENT_204)
}
