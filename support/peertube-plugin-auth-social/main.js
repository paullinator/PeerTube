'use strict'

const crypto = require('crypto')

// ---------------------------------------------------------------------------
// Provider definitions. Each provider only requests the email address.
// ---------------------------------------------------------------------------

const PROVIDERS = {
  google: {
    displayName: 'Google',
    usesPKCE: true,
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email',
    extractEmail: profile => profile.email,
    extractName: profile => profile.name || profile.email
  },
  facebook: {
    displayName: 'Facebook',
    usesPKCE: false,
    authorizeUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    userInfoUrl: 'https://graph.facebook.com/me?fields=email,name',
    scope: 'email',
    extractEmail: profile => profile.email,
    extractName: profile => profile.name || profile.email
  },
  twitter: {
    displayName: 'Twitter / X',
    usesPKCE: true,
    authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    // NOTE: Twitter/X OAuth2 does not reliably expose the email address. If your app does
    // not have email access, the login will fail with a clear error.
    userInfoUrl: 'https://api.twitter.com/2/users/me?user.fields=confirmed_email',
    scope: 'users.read tweet.read',
    extractEmail: profile => profile?.data?.confirmed_email,
    extractName: profile => profile?.data?.name || profile?.data?.username
  }
}

// state -> { provider, codeVerifier, createdAt }
const pendingStates = new Map()
const STATE_LIFETIME = 1000 * 60 * 10 // 10 minutes

// authName -> registerExternalAuth result (to call userAuthenticated from the callback)
const authResults = {}

// ---------------------------------------------------------------------------

async function register ({ registerExternalAuth, unregisterExternalAuth, registerSetting, settingsManager, peertubeHelpers, getRouter }) {
  const { logger } = peertubeHelpers

  for (const provider of Object.keys(PROVIDERS)) {
    const def = PROVIDERS[provider]

    registerSetting({
      name: `${provider}-enabled`,
      label: `Enable ${def.displayName} login`,
      type: 'input-checkbox',
      default: false,
      private: false
    })

    registerSetting({
      name: `${provider}-client-id`,
      label: `${def.displayName} client ID`,
      type: 'input',
      private: true
    })

    registerSetting({
      name: `${provider}-client-secret`,
      label: `${def.displayName} client secret`,
      type: 'input-password',
      private: true
    })
  }

  const callbackBaseUrl = peertubeHelpers.config.getWebserverUrl() + '/plugins/auth-social/router/callback'

  const registerProviders = async () => {
    const settings = await settingsManager.getSettings(
      Object.keys(PROVIDERS).map(p => `${p}-enabled`)
    )

    for (const provider of Object.keys(PROVIDERS)) {
      const def = PROVIDERS[provider]
      const enabled = settings[`${provider}-enabled`] === true

      if (!enabled) {
        if (authResults[provider]) {
          unregisterExternalAuth(provider)
          delete authResults[provider]
        }
        continue
      }

      if (authResults[provider]) continue

      authResults[provider] = registerExternalAuth({
        authName: provider,
        authDisplayName: () => def.displayName,

        onAuthRequest: async (req, res) => {
          try {
            await onAuthRequest({ provider, def, req, res, callbackBaseUrl, settingsManager, logger })
          } catch (err) {
            logger.error('auth-social: cannot start %s auth request.', provider, { err })
            res.redirect('/login?externalAuthError=true')
          }
        }
      })
    }
  }

  await registerProviders()
  settingsManager.onSettingsChange(() => registerProviders())

  // ---------------------------------------------------------------------------
  // OAuth callback router (stable, version-independent URL)
  // ---------------------------------------------------------------------------

  const router = getRouter()

  router.get('/callback/:provider', async (req, res) => {
    const provider = req.params.provider
    const def = PROVIDERS[provider]

    if (!def) return res.status(404).send('Unknown provider')

    try {
      const { code, state } = req.query

      const pending = pendingStates.get(state)
      pendingStates.delete(state)

      cleanupStates()

      if (!pending || pending.provider !== provider) {
        logger.warn('auth-social: invalid or expired state for %s.', provider)
        return res.redirect('/login?externalAuthError=true')
      }

      if (!code) {
        logger.warn('auth-social: missing authorization code for %s.', provider)
        return res.redirect('/login?externalAuthError=true')
      }

      const settings = await settingsManager.getSettings([ `${provider}-client-id`, `${provider}-client-secret` ])
      const clientId = settings[`${provider}-client-id`]
      const clientSecret = settings[`${provider}-client-secret`]

      const redirectUri = `${callbackBaseUrl}/${provider}`

      const tokenResponse = await exchangeCodeForToken({
        def,
        code,
        clientId,
        clientSecret,
        redirectUri,
        codeVerifier: pending.codeVerifier
      })

      const accessToken = tokenResponse.access_token
      if (!accessToken) {
        logger.error('auth-social: no access token returned by %s.', provider, { tokenResponse })
        return res.redirect('/login?externalAuthError=true')
      }

      const profile = await fetchJSON(def.userInfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })

      const email = def.extractEmail(profile)
      if (!email) {
        logger.error('auth-social: %s did not return an email address.', provider, { profile })
        return res.redirect('/login?externalAuthError=true')
      }

      const displayName = def.extractName(profile) || email
      const username = usernameFromEmail(email)

      const result = authResults[provider]
      if (!result) {
        logger.error('auth-social: %s auth is no longer registered.', provider)
        return res.redirect('/login?externalAuthError=true')
      }

      logger.info('auth-social: authenticated %s through %s.', email, provider)

      result.userAuthenticated({
        req,
        res,
        username,
        email,
        displayName
      })
    } catch (err) {
      logger.error('auth-social: error in %s callback.', provider, { err })
      return res.redirect('/login?externalAuthError=true')
    }
  })
}

async function unregister () {
  pendingStates.clear()
  for (const key of Object.keys(authResults)) delete authResults[key]
}

module.exports = {
  register,
  unregister
}

// ---------------------------------------------------------------------------

async function onAuthRequest ({ provider, def, req, res, callbackBaseUrl, settingsManager, logger }) {
  const settings = await settingsManager.getSettings([ `${provider}-client-id` ])
  const clientId = settings[`${provider}-client-id`]

  if (!clientId) {
    logger.error('auth-social: %s client id is not configured.', provider)
    return res.redirect('/login?externalAuthError=true')
  }

  const state = crypto.randomBytes(16).toString('hex')
  const redirectUri = `${callbackBaseUrl}/${provider}`

  const params = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: def.scope,
    state
  }

  let codeVerifier = null
  if (def.usesPKCE) {
    codeVerifier = base64url(crypto.randomBytes(32))
    const challenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest())
    params.code_challenge = challenge
    params.code_challenge_method = 'S256'
  }

  pendingStates.set(state, { provider, codeVerifier, createdAt: Date.now() })

  const url = def.authorizeUrl + '?' + new URLSearchParams(params).toString()
  res.redirect(url)
}

async function exchangeCodeForToken ({ def, code, clientId, clientSecret, redirectUri, codeVerifier }) {
  const body = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId
  }

  if (clientSecret) body.client_secret = clientSecret
  if (codeVerifier) body.code_verifier = codeVerifier

  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }

  // Twitter requires HTTP basic auth for confidential clients
  if (def === PROVIDERS.twitter && clientSecret) {
    headers.Authorization = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  }

  const res = await fetch(def.tokenUrl, {
    method: 'POST',
    headers,
    body: new URLSearchParams(body).toString()
  })

  return res.json()
}

async function fetchJSON (url, options) {
  const res = await fetch(url, options)
  return res.json()
}

function usernameFromEmail (email) {
  const localPart = email.split('@')[0]

  const sanitized = (localPart || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '_')
    .replace(/^[^a-z0-9_]+/, '')
    .replace(/[^a-z0-9_]+$/, '')

  return sanitized || 'user'
}

function base64url (buffer) {
  return buffer.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function cleanupStates () {
  const now = Date.now()
  for (const [ key, value ] of pendingStates) {
    if (now - value.createdAt > STATE_LIFETIME) pendingStates.delete(key)
  }
}
