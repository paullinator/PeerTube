import { HttpStatusCode } from '@peertube/peertube-models'
import { exists, isDateValid, isIdValid, toIntOrNull } from '@server/helpers/custom-validators/misc.js'
import { VideoChannelInviteModel } from '@server/models/video/video-channel-invite.js'
import express from 'express'
import { body, param } from 'express-validator'
import { areValidationErrors } from '../shared/index.js'

export const createVideoChannelInviteValidator = [
  body('maxUses')
    .optional({ nullable: true })
    .customSanitizer(toIntOrNull)
    .custom(value => value === null || (Number.isInteger(value) && value >= 1))
    .withMessage('Should have a valid maxUses (>= 1) or null'),

  body('expiresAt')
    .optional({ nullable: true })
    .custom(value => value === null || isDateValid(value))
    .withMessage('Should have a valid expiresAt date or null'),

  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (areValidationErrors(req, res)) return

    if (req.body.expiresAt && new Date(req.body.expiresAt).getTime() <= Date.now()) {
      return res.fail({ message: 'expiresAt must be in the future' })
    }

    return next()
  }
]

export const removeVideoChannelInviteValidator = [
  param('inviteId')
    .custom(isIdValid),

  async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (areValidationErrors(req, res)) return

    const invite = await VideoChannelInviteModel.loadByIdAndChannel(+req.params.inviteId, res.locals.videoChannel.id)
    if (!invite) {
      return res.fail({
        status: HttpStatusCode.NOT_FOUND_404,
        message: 'Invite not found for this channel'
      })
    }

    res.locals.videoChannelInvite = invite

    return next()
  }
]

// Load a (possibly invalid/expired) invite by code. requireRedeemable enforces it can still be used.
export function videoChannelInviteByCodeValidatorFactory (options: { requireRedeemable: boolean }) {
  return [
    param('code')
      .custom(exists),

    async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (areValidationErrors(req, res)) return

      const invite = await VideoChannelInviteModel.loadByCode(req.params.code)
      if (!invite) {
        return res.fail({
          status: HttpStatusCode.NOT_FOUND_404,
          message: 'Invite not found'
        })
      }

      if (options.requireRedeemable && !invite.isRedeemable()) {
        return res.fail({
          status: HttpStatusCode.FORBIDDEN_403,
          message: 'This invite link has expired or reached its maximum number of uses'
        })
      }

      res.locals.videoChannelInvite = invite

      return next()
    }
  ]
}
