/* oxlint-disable @typescript-eslint/no-unused-expressions,@typescript-eslint/require-await */

import { expect } from 'chai'
import { HttpStatusCode, VideoChannelAccessMode } from '@peertube/peertube-models'
import {
  cleanupTests,
  createMultipleServers,
  doubleFollow,
  PeerTubeServer,
  setAccessTokensToServers,
  waitJobs
} from '@peertube/peertube-server-commands'

describe('Test video channel access API validators', function () {
  let server: PeerTubeServer
  let remoteServer: PeerTubeServer

  let userToken: string

  before(async function () {
    this.timeout(60000)

    const servers = await createMultipleServers(2, {
      rates_limit: {
        login: {
          max: 100
        }
      }
    })

    server = servers[0]
    remoteServer = servers[1]
    await setAccessTokensToServers(servers)
    await doubleFollow(servers[0], servers[1])

    userToken = await server.users.generateUserAndToken('user1')

    await waitJobs(servers)
  })

  describe('When getting/updating channel access', function () {
    it('Should fail when not authenticated', async function () {
      await server.channels.getAccess({
        token: null,
        channelName: 'root_channel',
        expectedStatus: HttpStatusCode.UNAUTHORIZED_401
      })

      await server.channels.updateAccess({
        token: null,
        channelName: 'root_channel',
        attributes: { mode: VideoChannelAccessMode.PUBLIC },
        expectedStatus: HttpStatusCode.UNAUTHORIZED_401
      })
    })

    it('Should fail with a non owned channel', async function () {
      await server.channels.getAccess({
        token: userToken,
        channelName: 'root_channel',
        expectedStatus: HttpStatusCode.FORBIDDEN_403
      })

      await server.channels.updateAccess({
        token: userToken,
        channelName: 'root_channel',
        attributes: { mode: VideoChannelAccessMode.PUBLIC },
        expectedStatus: HttpStatusCode.FORBIDDEN_403
      })
    })

    it('Should fail with a remote channel', async function () {
      await server.channels.getAccess({
        channelName: 'root_channel@' + remoteServer.host,
        expectedStatus: HttpStatusCode.FORBIDDEN_403
      })
    })

    it('Should fail with an invalid mode', async function () {
      await server.channels.updateAccess({
        channelName: 'root_channel',
        attributes: { mode: 42 as any },
        expectedStatus: HttpStatusCode.BAD_REQUEST_400
      })
    })

    it('Should fail with an invalid password', async function () {
      await server.channels.updateAccess({
        channelName: 'root_channel',
        attributes: { mode: VideoChannelAccessMode.RESTRICTED, passwords: [ 'a' ] },
        expectedStatus: HttpStatusCode.BAD_REQUEST_400
      })
    })

    it('Should fail with an unknown allowed account', async function () {
      await server.channels.updateAccess({
        channelName: 'root_channel',
        attributes: { mode: VideoChannelAccessMode.RESTRICTED, allowedAccountNames: [ 'unknownaccount' ] },
        expectedStatus: HttpStatusCode.NOT_FOUND_404
      })
    })

    it('Should succeed with the correct parameters', async function () {
      await server.channels.updateAccess({
        channelName: 'root_channel',
        attributes: {
          mode: VideoChannelAccessMode.RESTRICTED,
          passwords: [ 'my super password' ],
          allowedAccountNames: [ 'user1' ]
        }
      })

      await server.channels.getAccess({ channelName: 'root_channel' })
    })
  })

  describe('When rotating channel access', function () {
    it('Should fail when not authenticated', async function () {
      await server.channels.rotateAccess({
        token: null,
        channelName: 'root_channel',
        expectedStatus: HttpStatusCode.UNAUTHORIZED_401
      })
    })

    it('Should fail with a non owned channel', async function () {
      await server.channels.rotateAccess({
        token: userToken,
        channelName: 'root_channel',
        expectedStatus: HttpStatusCode.FORBIDDEN_403
      })
    })

    it('Should succeed with the correct parameters', async function () {
      await server.channels.rotateAccess({ channelName: 'root_channel' })
    })
  })

  describe('When requesting channel access', function () {
    it('Should not fail with a wrong password (returns success: false)', async function () {
      const { success } = await server.channels.requestAccess({ token: null, channelName: 'root_channel', password: 'wrong' })

      expect(success).to.be.false
    })

    it('Should fail with an unknown channel', async function () {
      await server.channels.requestAccess({
        token: null,
        channelName: 'unknown_channel',
        password: 'whatever',
        expectedStatus: HttpStatusCode.NOT_FOUND_404
      })
    })
  })

  after(async function () {
    await cleanupTests([ server, remoteServer ])
  })
})
