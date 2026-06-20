/* oxlint-disable @typescript-eslint/no-unused-expressions,@typescript-eslint/require-await */

import { expect } from 'chai'
import { HttpStatusCode, VideoChannelAccessMode } from '@peertube/peertube-models'
import {
  cleanupTests,
  createSingleServer,
  PeerTubeServer,
  setAccessTokensToServers,
  setDefaultAccountAvatar,
  setDefaultChannelAvatar
} from '@peertube/peertube-server-commands'

describe('Test channel invite links', function () {
  let server: PeerTubeServer
  let channelName: string

  before(async function () {
    this.timeout(120000)

    server = await createSingleServer(1)
    await setAccessTokensToServers([ server ])
    await setDefaultChannelAvatar(server)
    await setDefaultAccountAvatar(server)

    const { videoChannels } = await server.users.getMyInfo()
    channelName = videoChannels[0].name

    await server.channels.updateAccess({
      channelName,
      attributes: { mode: VideoChannelAccessMode.RESTRICTED, passwords: [], allowedAccountNames: [] }
    })
  })

  let code: string
  let inviteId: number

  it('Should create an invite link', async function () {
    const invite = await server.channels.createInvite({ channelName, maxUses: 2 })

    expect(invite.code).to.have.length.above(0)
    expect(invite.uses).to.equal(0)
    expect(invite.maxUses).to.equal(2)
    expect(invite.url).to.contain('/video-channels/invite/')

    code = invite.code
    inviteId = invite.id
  })

  it('Should list invite links', async function () {
    const { total, data } = await server.channels.listInvites({ channelName })

    expect(total).to.equal(1)
    expect(data[0].code).to.equal(code)
  })

  it('Should get public invite info without auth', async function () {
    const info = await server.channels.getInviteInfo({ code, token: null })

    expect(info.valid).to.be.true
    expect(info.channel.name).to.equal(channelName)
  })

  it('Should grant access to an existing logged-in account on redeem', async function () {
    const userToken = await server.users.generateUserAndToken('inviteduser')

    const { channelHandle } = await server.channels.redeemInvite({ code, token: userToken })
    expect(channelHandle).to.equal(channelName)

    const access = await server.channels.getAccess({ channelName })
    expect(access.allowedAccounts.some(a => a.name === 'inviteduser')).to.be.true
  })

  it('Should allow sign-up via an invite even when signup is disabled', async function () {
    await server.config.updateExistingConfig({ newConfig: { signup: { enabled: false } } })

    await server.registrations.register({
      username: 'invitedsignup',
      password: 'super password',
      email: 'invitedsignup@example.com',
      channelInviteCode: code
    })

    const access = await server.channels.getAccess({ channelName })
    expect(access.allowedAccounts.some(a => a.name === 'invitedsignup')).to.be.true
  })

  it('Should reject redeeming once the invite reached its max uses', async function () {
    // maxUses=2 already consumed by inviteduser + invitedsignup
    const userToken = await server.users.generateUserAndToken('lateuser')

    await server.channels.redeemInvite({ code, token: userToken, expectedStatus: HttpStatusCode.FORBIDDEN_403 })
  })

  it('Should revoke an invite link', async function () {
    await server.channels.removeInvite({ channelName, inviteId })

    const { total } = await server.channels.listInvites({ channelName })
    expect(total).to.equal(0)
  })

  after(async function () {
    await cleanupTests([ server ])
  })
})
