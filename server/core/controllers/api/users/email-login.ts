import { HttpStatusCode } from '@peertube/peertube-models'
import { logger, loggerTagsFactory } from '@server/helpers/logger.js'
import { CONFIG } from '@server/initializers/config.js'
import { EMAIL_LOGIN_REFRESH_TOKEN_LIFETIME } from '@server/initializers/constants.js'
import { createAuthTokensForUser } from '@server/lib/auth/oauth.js'
import { getEmailLoginUrl } from '@server/lib/client-urls.js'
import { Emailer } from '@server/lib/emailer.js'
import { Hooks } from '@server/lib/plugins/hooks.js'
import { Redis } from '@server/lib/redis.js'
import { buildUser, createUserAccountAndChannelAndPlaylist, deriveUsernameFromEmail, getByEmailPermissive } from '@server/lib/user.js'
import { asyncMiddleware, buildRateLimiter } from '@server/middlewares/index.js'
import { emailLoginCompleteValidator, emailLoginRequestValidator } from '@server/middlewares/validators/users/email-login.js'
import { UserModel } from '@server/models/user/user.js'
import { MUserDefault } from '@server/types/models/index.js'
import express from 'express'

const lTags = loggerTagsFactory('email-login')

const emailLoginRouter = express.Router()

const emailLoginRateLimiter = buildRateLimiter({
  windowMs: CONFIG.RATES_LIMIT.LOGIN.WINDOW_MS,
  max: CONFIG.RATES_LIMIT.LOGIN.MAX
})

emailLoginRouter.post(
  '/email-login/request',
  emailLoginRateLimiter,
  emailLoginRequestValidator,
  asyncMiddleware(requestEmailLogin)
)

emailLoginRouter.post(
  '/email-login/complete',
  emailLoginRateLimiter,
  emailLoginCompleteValidator,
  asyncMiddleware(completeEmailLogin)
)

// ---------------------------------------------------------------------------

export {
  emailLoginRouter
}

// ---------------------------------------------------------------------------

async function requestEmailLogin (req: express.Request, res: express.Response) {
  const email = (req.body.email as string).toLowerCase()
  const channelInviteCode = req.body.channelInviteCode as string | undefined

  const { verificationString, otp } = await Redis.Instance.setEmailLoginVerification(email)

  Emailer.Instance.addEmailLoginJob({
    to: email,
    language: CONFIG.INSTANCE.DEFAULT_LANGUAGE,
    loginUrl: getEmailLoginUrl(email, verificationString, channelInviteCode),
    otp
  })

  logger.info('Sent an email login link to %s.', email, lTags())

  // Always answer 204 to avoid leaking whether an account exists
  return res.status(HttpStatusCode.NO_CONTENT_204).end()
}

async function completeEmailLogin (req: express.Request, res: express.Response) {
  const email = (req.body.email as string).toLowerCase()
  const { verificationString, otp } = req.body

  const stored = await Redis.Instance.getEmailLoginVerification(email)

  if (!stored) {
    return res.fail({
      status: HttpStatusCode.FORBIDDEN_403,
      message: req.t('This login link is invalid or has expired')
    })
  }

  const matches = (verificationString && verificationString === stored.verificationString) ||
    (otp && otp === stored.otp)

  if (!matches) {
    return res.fail({
      status: HttpStatusCode.FORBIDDEN_403,
      message: req.t('This login link is invalid or has expired')
    })
  }

  // Single use
  await Redis.Instance.removeEmailLoginVerification(email)

  let user = getByEmailPermissive(await UserModel.loadByEmailCaseInsensitive(email), email)

  if (!user) {
    user = await createEmailLoginUser(email)
    logger.info('Created a new account %s through email login.', user.username, lTags())
  }

  if (user.blocked) {
    return res.fail({
      status: HttpStatusCode.FORBIDDEN_403,
      message: req.t('Your account is blocked')
    })
  }

  const token = await createAuthTokensForUser({
    user,
    req,
    refreshTokenLifetimeOverride: EMAIL_LOGIN_REFRESH_TOKEN_LIFETIME
  })

  Hooks.runAction('action:api.user.oauth2-got-token', { username: token.user.username, ip: req.ip, req, res })

  res.set('Cache-Control', 'no-store')
  res.set('Pragma', 'no-cache')

  return res.json({
    token_type: 'Bearer',

    access_token: token.accessToken,
    refresh_token: token.refreshToken,

    expires_in: token.accessTokenExpiresIn,
    refresh_token_expires_in: token.refreshTokenExpiresIn
  })
}

async function createEmailLoginUser (email: string): Promise<MUserDefault> {
  const username = await deriveUsernameFromEmail(email)

  const userToCreate = buildUser({
    username,
    password: null,
    email,
    // The user proved ownership of the email by following the link/OTP
    emailVerified: true
  })

  // Simplified (email-only) signup: keep onboarding frictionless by not prompting the
  // freshly created account to set up an avatar/description.
  userToCreate.noAccountSetupWarningModal = true

  const { user } = await createUserAccountAndChannelAndPlaylist({
    userToCreate,
    userDisplayName: username
  })

  return user
}
