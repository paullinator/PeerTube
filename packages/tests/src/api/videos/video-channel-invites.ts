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

  it('Should create an invite link with a client-supplied code', async function () {
    code = 'clientcode1'

    const invite = await server.channels.createInvite({ channelName, code, maxUses: 2 })

    expect(invite.code).to.equal(code)
    expect(invite.uses).to.equal(0)
    expect(invite.maxUses).to.equal(2)
    expect(invite.url).to.contain(code)

    inviteId = invite.id
  })

  it('Should create an invite link with a custom alphanumeric Link ID', async function () {
    const customCode = 'MyCustomLinkID42'

    const invite = await server.channels.createInvite({ channelName, code: customCode })

    expect(invite.code).to.equal(customCode)
    expect(invite.url).to.contain(customCode)

    await server.channels.removeInvite({ channelName, inviteId: invite.id })
  })

  it('Should reject creating an invite with a duplicate code', async function () {
    await server.channels.createInvite({ channelName, code, expectedStatus: HttpStatusCode.CONFLICT_409 })
  })

  it('Should reject creating an invite with an invalid code', async function () {
    // Non-alphanumeric characters are rejected
    await server.channels.createInvite({ channelName, code: 'bad code!', expectedStatus: HttpStatusCode.BAD_REQUEST_400 })
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
