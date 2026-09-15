/* oxlint-disable @typescript-eslint/no-unused-expressions,@typescript-eslint/require-await */

import { HttpStatusCode } from '@peertube/peertube-models'
import {
  cleanupTests,
  createSingleServer,
  makeGetRequest,
  makePostBodyRequest,
  PeerTubeServer,
  setAccessTokensToServers,
  setDefaultVideoChannel,
  waitJobs
} from '@peertube/peertube-server-commands'

describe('Test video stored files API validator', function () {
  let server: PeerTubeServer
  let userToken: string
  let videoUUID: string

  before(async function () {
    this.timeout(120_000)

    server = await createSingleServer(1, {
      transcoding: {
        enabled: true,
        original_file: { keep: true }
      }
    })

    await setAccessTokensToServers([ server ])
    await setDefaultVideoChannel([ server ])

    userToken = await server.users.generateUserAndToken('user1')

    const { uuid } = await server.videos.quickUpload({ name: 'video' })
    videoUUID = uuid

    await waitJobs([ server ])
  })

  describe('When listing stored files', function () {

    it('Should fail without a token', async function () {
      await makeGetRequest({ url: server.url, path: '/api/v1/videos/' + videoUUID + '/stored-files', expectedStatus: HttpStatusCode.UNAUTHORIZED_401 })
    })

    it('Should fail with another user', async function () {
      await server.videos.getStoredFiles({ id: videoUUID, token: userToken, expectedStatus: HttpStatusCode.FORBIDDEN_403 })
    })

    it('Should fail with an unknown video', async function () {
      await server.videos.getStoredFiles({ id: 'a2d1a5bd-50b5-4d8a-9a3c-5ab3e8d0d7c1', expectedStatus: HttpStatusCode.NOT_FOUND_404 })
    })

    it('Should succeed with the owner', async function () {
      await server.videos.getStoredFiles({ id: videoUUID })
    })
  })

  describe('When copying the original file into HLS', function () {
    const path = () => '/api/v1/videos/' + videoUUID + '/source/hls-copy'

    it('Should fail without a token', async function () {
      await makePostBodyRequest({ url: server.url, path: path(), fields: {}, expectedStatus: HttpStatusCode.UNAUTHORIZED_401 })
    })

    it('Should fail with another user', async function () {
      await server.videos.createHLSCopyFromSource({ id: videoUUID, token: userToken, expectedStatus: HttpStatusCode.FORBIDDEN_403 })
    })

    it('Should fail with a bad force value', async function () {
      await makePostBodyRequest({
        url: server.url,
        path: path(),
        token: server.accessToken,
        fields: { force: 'hello' },
        expectedStatus: HttpStatusCode.BAD_REQUEST_400
      })
    })

    it('Should fail with an unknown video', async function () {
      await server.videos.createHLSCopyFromSource({ id: 'a2d1a5bd-50b5-4d8a-9a3c-5ab3e8d0d7c1', expectedStatus: HttpStatusCode.NOT_FOUND_404 })
    })

    it('Should succeed with the owner', async function () {
      this.timeout(60_000)

      await server.videos.createHLSCopyFromSource({ id: videoUUID })
      await waitJobs([ server ])
    })

    it('Should fail when the original file is not kept', async function () {
      await server.videos.deleteSource({ id: videoUUID })

      await server.videos.createHLSCopyFromSource({ id: videoUUID, expectedStatus: HttpStatusCode.BAD_REQUEST_400 })
    })
  })

  after(async function () {
    await cleanupTests([ server ])
  })
})
