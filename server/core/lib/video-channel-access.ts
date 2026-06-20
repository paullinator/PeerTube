import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { Request, Response } from 'express'
import { CHANNEL_ACCESS, WEBSERVER } from '../initializers/constants.js'
import { CONFIG } from '../initializers/config.js'

// ---------------------------------------------------------------------------
// Stateless, signed per-channel access tokens.
//
// A token proves a viewer unlocked a restricted channel (via password or because
// their account was on the allow-list). It is signed with the per-channel
// `tokenSecret` combined with the instance secret, so rotating the channel secret
// invalidates every previously issued token (and the cookies storing them).
// ---------------------------------------------------------------------------

export function generateChannelTokenSecret () {
  return randomBytes(32).toString('hex')
}

export function generateChannelAccessToken (options: {
  channelId: number
  tokenSecret: string
  expiresInMs?: number
}) {
  const { channelId, tokenSecret, expiresInMs = CHANNEL_ACCESS.TOKEN_LIFETIME } = options

  const expires = Date.now() + expiresInMs
  const payload = `${channelId}.${expires}`
  const signature = sign(payload, tokenSecret)

  return Buffer.from(`${payload}.${signature}`).toString('base64url')
}

export function isChannelAccessTokenValid (options: {
  token: string
  channelId: number
  tokenSecret: string
}) {
  const { token, channelId, tokenSecret } = options

  if (!token) return false

  let decoded: string
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8')
  } catch {
    return false
  }

  const parts = decoded.split('.')
  if (parts.length !== 3) return false

  const [ tokenChannelId, expires, signature ] = parts

  if (forceNumber(tokenChannelId) !== channelId) return false
  if (forceNumber(expires) < Date.now()) return false

  const expectedSignature = sign(`${tokenChannelId}.${expires}`, tokenSecret)

  return safeEqual(signature, expectedSignature)
}

// ---------------------------------------------------------------------------

export function getChannelAccessTokenFromRequest (req: Request, channelId: number) {
  const headerToken = req.header(CHANNEL_ACCESS.TOKEN_HEADER)
  if (headerToken) return headerToken

  const cookieName = getChannelAccessCookieName(channelId)
  return req.cookies?.[cookieName]
}

// Issue an access token and persist it as a cookie
export function grantChannelAccess (res: Response, channelId: number, tokenSecret: string) {
  const token = generateChannelAccessToken({ channelId, tokenSecret })
  setChannelAccessCookie(res, channelId, token)

  return token
}

export function setChannelAccessCookie (res: Response, channelId: number, token: string) {
  res.cookie(getChannelAccessCookieName(channelId), token, {
    maxAge: CHANNEL_ACCESS.TOKEN_LIFETIME,
    httpOnly: false, // Must be readable by the player/embed JS to forward as a header
    secure: WEBSERVER.SCHEME === 'https',
    sameSite: 'lax',
    path: '/'
  })
}

export function getChannelAccessCookieName (channelId: number) {
  return CHANNEL_ACCESS.COOKIE_PREFIX + channelId
}

// ---------------------------------------------------------------------------
// Private
// ---------------------------------------------------------------------------

function sign (payload: string, tokenSecret: string) {
  return createHmac('sha256', CONFIG.SECRETS.PEERTUBE + tokenSecret)
    .update(payload)
    .digest('hex')
}

function safeEqual (a: string, b: string) {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)

  if (bufA.length !== bufB.length) return false

  return timingSafeEqual(bufA, bufB)
}

function forceNumber (value: string) {
  return parseInt(value, 10)
}
