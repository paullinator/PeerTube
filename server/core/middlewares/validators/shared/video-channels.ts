import { HttpStatusCode, ServerErrorCode, UserRight, UserRightType, VideoChannelAccessMode } from '@peertube/peertube-models'
import {
  getChannelAccessTokenFromRequest,
  grantChannelAccess,
  isChannelAccessTokenValid
} from '@server/lib/video-channel-access.js'
import { VideoChannelAccessModel } from '@server/models/video/video-channel-access.js'
import { VideoChannelAllowedAccountModel } from '@server/models/video/video-channel-allowed-account.js'
import { VideoChannelCollaboratorModel } from '@server/models/video/video-channel-collaborator.js'
import { VideoChannelPasswordModel } from '@server/models/video/video-channel-password.js'
import { VideoChannelModel } from '@server/models/video/video-channel.js'
import { MChannelAccountDefault, MChannelBannerAccountDefault, MChannelUserId, MUserAccountId } from '@server/types/models/index.js'
import express from 'express'
import { CHANNEL_ACCESS } from '@server/initializers/constants.js'
import { checkCanManageAccount } from './users.js'

type CommonOptions = {
  checkCanManage: boolean // Also check the user can manage the account
  checkIsOwner: boolean // Also check this is the owner of the channel
  req: express.Request
  res: express.Response
  specialRight?: UserRightType
}

export async function doesChannelIdExist (
  options: CommonOptions & {
    id: number
    checkIsLocal: boolean // Also check this is a local channel
  }
) {
  const { id, checkCanManage, checkIsLocal, checkIsOwner, req, res, specialRight } = options

  const channel = await VideoChannelModel.loadAndPopulateAccount(+id)

  return processVideoChannelExist({ channel, checkCanManage, checkIsLocal, checkIsOwner, req, res, specialRight })
}

export async function doesChannelHandleExist (
  options: CommonOptions & {
    handle: string
    checkIsLocal: boolean // Also check this is a local channel
  }
) {
  const { handle, checkCanManage, checkIsLocal, checkIsOwner, req, res, specialRight } = options

  const channel = await VideoChannelModel.loadByHandleAndPopulateAccount(handle)

  return processVideoChannelExist({ channel, checkCanManage, checkIsLocal, checkIsOwner, req, res, specialRight })
}

export async function checkCanManageChannel (
  options: CommonOptions & {
    user: MUserAccountId
    channel: MChannelUserId
  }
) {
  const { channel, user, req, res, checkCanManage, checkIsOwner, specialRight = UserRight.MANAGE_ANY_VIDEO_CHANNEL } = options

  if (!channel) {
    res?.fail({
      status: HttpStatusCode.NOT_FOUND_404,
      message: req.t('Video channel not found')
    })
    return false
  }

  if (checkIsOwner || checkCanManage) {
    if (!user) {
      res?.fail({
        status: HttpStatusCode.UNAUTHORIZED_401,
        message: req.t('Authentication is required')
      })
      return false
    }

    const isOwner = checkCanManageAccount({
      account: channel.Account,
      user,
      req,
      res: null,
      specialRight
    })

    if (!isOwner) {
      if (checkIsOwner) {
        res?.fail({
          status: HttpStatusCode.FORBIDDEN_403,
          message: req.t('This user has not owner rights on this channel')
        })

        return false
      }

      if (checkCanManage && !await VideoChannelCollaboratorModel.isCollaborator({ user, channel })) {
        res?.fail({
          status: HttpStatusCode.FORBIDDEN_403,
          message: req.t('This user cannot manage this channel')
        })
        return false
      }
    }
  }

  return true
}

// ---------------------------------------------------------------------------
// Per-channel access control (viewing)
// ---------------------------------------------------------------------------

// Returns true if the caller is allowed to view the (restricted or not) channel content.
// When access is newly proven (password/allow-list), issues a signed access cookie.
export async function checkCanViewChannel (options: {
  req: express.Request
  res: express.Response
  channel: MChannelUserId & { Actor?: { preferredUsername?: string } }
  // null => do not write a failure response, just return false
  failRes: express.Response | null
}): Promise<boolean> {
  const { req, res, channel, failRes } = options

  const access = await VideoChannelAccessModel.loadByChannelId(channel.id)

  // No policy row, or explicitly public => behaves exactly like stock PeerTube
  if (!access || access.mode !== VideoChannelAccessMode.RESTRICTED) return true

  // Channel managers (owner/collaborator/admin) always bypass the gate
  const user = res.locals.oauth?.token.User
  if (user) {
    if (await checkCanManageChannel({ channel, user, req, res: null, checkCanManage: true, checkIsOwner: false })) {
      return true
    }

    // Allow-listed account => grant + persist access
    if (await VideoChannelAllowedAccountModel.isAllowedForUser({ userId: user.id, channelId: channel.id })) {
      grantChannelAccess(res, channel.id, access.tokenSecret)
      return true
    }
  }

  // Already-proven access via signed cookie/header
  const token = getChannelAccessTokenFromRequest(req, channel.id)
  if (token && isChannelAccessTokenValid({ token, channelId: channel.id, tokenSecret: access.tokenSecret })) {
    return true
  }

  const channelHandle = buildChannelHandle(channel)

  // Try a submitted channel password
  const password = req.header(CHANNEL_ACCESS.PASSWORD_HEADER)
  if (password) {
    if (await VideoChannelPasswordModel.isACorrectPassword({ channelId: channel.id, password })) {
      grantChannelAccess(res, channel.id, access.tokenSecret)
      return true
    }

    failRes?.fail({
      status: HttpStatusCode.FORBIDDEN_403,
      type: ServerErrorCode.INCORRECT_CHANNEL_PASSWORD,
      message: req.t('Incorrect channel password. Access to the channel is denied'),
      data: { channel: channelHandle }
    })
    return false
  }

  const hasPassword = await VideoChannelPasswordModel.countByChannelId(channel.id) > 0

  failRes?.fail({
    status: HttpStatusCode.FORBIDDEN_403,
    type: hasPassword
      ? ServerErrorCode.CHANNEL_REQUIRES_PASSWORD
      : ServerErrorCode.CHANNEL_ACCESS_DENIED,
    message: hasPassword
      ? req.t('Please provide a password to access this channel')
      : req.t('You are not allowed to access this channel'),
    data: { channel: channelHandle }
  })

  return false
}

function buildChannelHandle (channel: MChannelUserId & { Actor?: { preferredUsername?: string } }) {
  return channel.Actor?.preferredUsername
}

// For the channel get endpoint: lightweight info so the client can render the gate
export async function buildChannelViewerAccessInfo (req: express.Request, res: express.Response, channel: MChannelAccountDefault) {
  const access = await VideoChannelAccessModel.loadByChannelId(channel.id)

  if (!access || access.mode !== VideoChannelAccessMode.RESTRICTED) {
    return { mode: VideoChannelAccessMode.PUBLIC, requiresPassword: false, viewerHasAccess: true }
  }

  const requiresPassword = await VideoChannelPasswordModel.countByChannelId(channel.id) > 0

  const viewerHasAccess = await checkCanViewChannel({ req, res, channel, failRes: null })

  return { mode: VideoChannelAccessMode.RESTRICTED, requiresPassword, viewerHasAccess }
}

// ---------------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------------

async function processVideoChannelExist (
  options: CommonOptions & {
    channel: MChannelBannerAccountDefault
    checkIsLocal: boolean // Also check this is a local channel
  }
) {
  const { channel, req, res, checkCanManage, checkIsLocal, checkIsOwner, specialRight = UserRight.MANAGE_ANY_VIDEO_CHANNEL } = options

  const user = res.locals.oauth?.token.User
  if (!await checkCanManageChannel({ channel, user, req, res, checkCanManage, checkIsOwner, specialRight })) return false

  if (checkIsLocal && channel.Actor.isLocal() === false) {
    res.fail({
      status: HttpStatusCode.FORBIDDEN_403,
      message: req.t('The channel must be local.')
    })

    return false
  }

  res.locals.videoChannel = channel
  return true
}
