import { HttpStatusCode } from '@peertube/peertube-models'
import { CONFIG } from '@server/initializers/config.js'
import express from 'express'
import { body } from 'express-validator'
import { areValidationErrors } from '../shared/index.js'

const ensureEmailLoginEnabled = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (CONFIG.SIGNUP.EMAIL_ONLY !== true) {
    return res.fail({
      status: HttpStatusCode.CONFLICT_409,
      message: req.t('Email-only login is not enabled on this instance')
    })
  }

  return next()
}

const emailLoginRequestValidator = [
  ensureEmailLoginEnabled,

  body('email')
    .isEmail().withMessage('Should have a valid email'),

  // Carried through to the magic-link URL so an invite signup is still redeemed after login
  body('channelInviteCode')
    .optional()
    .isString().notEmpty().withMessage('Should have a valid channel invite code'),

  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (areValidationErrors(req, res)) return

    return next()
  }
]

const emailLoginCompleteValidator = [
  ensureEmailLoginEnabled,

  body('email')
    .isEmail().withMessage('Should have a valid email'),

  body('verificationString')
    .optional()
    .isString().notEmpty().withMessage('Should have a valid verification string'),

  body('otp')
    .optional()
    .isString().notEmpty().withMessage('Should have a valid OTP'),

  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (areValidationErrors(req, res)) return

    if (!req.body.verificationString && !req.body.otp) {
      return res.fail({
        status: HttpStatusCode.BAD_REQUEST_400,
        message: req.t('Should provide either a verification string or an OTP')
      })
    }

    return next()
  }
]

export {
  emailLoginRequestValidator,
  emailLoginCompleteValidator
}
