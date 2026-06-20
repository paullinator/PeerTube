/* oxlint-disable @typescript-eslint/no-unused-expressions,@typescript-eslint/require-await */

import { expect } from 'chai'
import { HttpStatusCode, ServerErrorCode, VideoChannelAccessMode } from '@peertube/peertube-models'
import {
  cleanupTests,
  createSingleServer,
  PeerTubeServer,
  setAccessTokensToServers,
  setDefaultAccountAvatar,
  setDefaultChannelAvatar
} from '@peertube/peertube-server-commands'

describe('Test video channel access', function () {
  let server: PeerTubeServer

  let ownerToken: string
  let channelName: string

  let allowedUserToken: string
  let allowedAccountName: string

  let otherUserToken: string

  const password = 'my super channel password'

  before(async function () {
    this.timeout(120000)

    server = await createSingleServer(1)
    await setAccessTokensToServers([ server ])
    await setDefaultChannelAvatar(server)
    await setDefaultAccountAvatar(server)

    // Owner channel
    ownerToken = server.accessToken
    const { videoChannels } = await server.users.getMyInfo()
    channelName = videoChannels[0].name

    await server.videos.upload({ attributes: { name: 'public video', channelId: videoChannels[0].id } })

    // An account that we will add to the allow-list
    allowedUserToken = await server.users.generateUserAndToken('alloweduser')
    const allowedInfo = await server.users.getMyInfo({ token: allowedUserToken })
    allowedAccountName = allowedInfo.account.name

    // Another account with no special access
    otherUserToken = await server.users.generateUserAndToken('otheruser')
  })

  it('Should default to a public access mode', async function () {
    const access = await server.channels.getAccess({ channelName })

    expect(access.mode).to.equal(VideoChannelAccessMode.PUBLIC)
    expect(access.passwords).to.have.lengthOf(0)
    expect(access.allowedAccounts).to.have.lengthOf(0)
  })

  it('Should list channel videos publicly when public', async function () {
    const body = await server.videos.listByChannel({ handle: channelName, token: null })

    expect(body.total).to.equal(1)
  })

  it('Should restrict the channel with a password and an allowed account', async function () {
    await server.channels.updateAccess({
      channelName,
      attributes: {
        mode: VideoChannelAccessMode.RESTRICTED,
        passwords: [ password ],
        allowedAccountNames: [ allowedAccountName ]
      }
    })

    const access = await server.channels.getAccess({ channelName })
    expect(access.mode).to.equal(VideoChannelAccessMode.RESTRICTED)
    expect(access.passwords).to.have.lengthOf(1)
    expect(access.allowedAccounts.map(a => a.name)).to.contain(allowedAccountName)
  })

  it('Should deny anonymous access to channel videos', async function () {
    const body = await server.videos.listByChannel({
      handle: channelName,
      token: null,
      expectedStatus: HttpStatusCode.FORBIDDEN_403
    }) as any

    expect(body.code).to.equal(ServerErrorCode.CHANNEL_REQUIRES_PASSWORD)
  })

  it('Should allow access to channel videos with the correct password header', async function () {
    const body = await server.videos.listByChannel({
      handle: channelName,
      token: null,
      headers: { 'x-peertube-channel-password': password }
    })

    expect(body.total).to.equal(1)
  })

  it('Should reject an incorrect password on the request endpoint', async function () {
    const { success } = await server.channels.requestAccess({ channelName, password: 'wrong', token: null })

    expect(success).to.be.false
  })

  it('Should accept the correct password on the request endpoint', async function () {
    const { success } = await server.channels.requestAccess({ channelName, password, token: null })

    expect(success).to.be.true
  })

  it('Should let the owner access channel videos', async function () {
    const body = await server.videos.listByChannel({ handle: channelName, token: ownerToken })

    expect(body.total).to.equal(1)
  })

  it('Should let an allow-listed account access channel videos without a password', async function () {
    const body = await server.videos.listByChannel({ handle: channelName, token: allowedUserToken })

    expect(body.total).to.equal(1)
  })

  it('Should deny a non allow-listed account without a password', async function () {
    await server.videos.listByChannel({
      handle: channelName,
      token: otherUserToken,
      expectedStatus: HttpStatusCode.FORBIDDEN_403
    })
  })

  it('Should expose access info on the channel get endpoint', async function () {
    const channel = await server.channels.get({ channelName, token: null })

    expect(channel.accessMode).to.equal(VideoChannelAccessMode.RESTRICTED)
    expect(channel.requiresPassword).to.be.true
    expect(channel.viewerHasAccess).to.be.false
  })

  it('Should revoke all existing access', async function () {
    await server.channels.rotateAccess({ channelName })

    // The previous request-access cookie path is stateless; a fresh anonymous list is still denied
    await server.videos.listByChannel({
      handle: channelName,
      token: null,
      expectedStatus: HttpStatusCode.FORBIDDEN_403
    })
  })

  it('Should make the channel public again', async function () {
    await server.channels.updateAccess({
      channelName,
      attributes: { mode: VideoChannelAccessMode.PUBLIC }
    })

    const body = await server.videos.listByChannel({ handle: channelName, token: null })
    expect(body.total).to.equal(1)

    const access = await server.channels.getAccess({ channelName })
    expect(access.mode).to.equal(VideoChannelAccessMode.PUBLIC)
    expect(access.passwords).to.have.lengthOf(0)
    expect(access.allowedAccounts).to.have.lengthOf(0)
  })

  after(async function () {
    await cleanupTests([ server ])
  })
})
