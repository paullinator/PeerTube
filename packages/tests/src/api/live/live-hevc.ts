/* oxlint-disable @typescript-eslint/no-unused-expressions,@typescript-eslint/require-await */

import { ffprobePromise } from '@peertube/peertube-ffmpeg'
import { VideoPrivacy } from '@peertube/peertube-models'
import {
  ConfigCommand,
  PeerTubeServer,
  cleanupTests,
  createMultipleServers,
  doubleFollow,
  setAccessTokensToServers,
  setDefaultVideoChannel,
  stopFfmpeg,
  waitJobs,
  waitUntilLivePublishedOnAllServers,
  waitUntilLiveReplacedByReplayOnAllServers
} from '@peertube/peertube-server-commands'
import { testLiveVideoResolutions } from '@tests/shared/live.js'
import { SQLCommand } from '@tests/shared/sql-command.js'
import { expect } from 'chai'

describe('Test HEVC live', function () {
  let servers: PeerTubeServer[] = []
  let sqlCommandServer1: SQLCommand

  async function createLive (saveReplay: boolean) {
    const { uuid } = await servers[0].live.create({
      fields: {
        name: 'hevc live',
        channelId: servers[0].store.channel.id,
        privacy: VideoPrivacy.PUBLIC,
        saveReplay,
        replaySettings: saveReplay
          ? { privacy: VideoPrivacy.PUBLIC }
          : undefined
      }
    })

    return uuid
  }

  function updateLiveConf (transcoding: boolean) {
    return servers[0].config.updateExistingConfig({
      newConfig: {
        live: {
          enabled: true,
          allowReplay: true,
          maxDuration: -1,
          transcoding: {
            enabled: transcoding,
            resolutions: ConfigCommand.getConfigResolutions(false)
          }
        }
      }
    })
  }

  before(async function () {
    this.timeout(120000)

    servers = await createMultipleServers(2)

    await setAccessTokensToServers(servers)
    await setDefaultVideoChannel(servers)

    await doubleFollow(servers[0], servers[1])

    await servers[0].config.enableMinimumTranscoding()

    sqlCommandServer1 = new SQLCommand(servers[0])
  })

  describe('With live transcoding', function () {

    it('Should accept an Enhanced RTMP HEVC stream and transcode it to H.264', async function () {
      this.timeout(240000)

      await updateLiveConf(true)
      const liveVideoId = await createLive(false)

      const ffmpegCommand = await servers[0].live.sendRTMPStreamInVideo({ videoId: liveVideoId, videoCodec: 'hevc' })
      await waitUntilLivePublishedOnAllServers(servers, liveVideoId)
      await waitJobs(servers)

      await testLiveVideoResolutions({
        originServer: servers[0],
        sqlCommand: sqlCommandServer1,
        servers,
        liveVideoId,
        resolutions: [ 720 ],
        transcoded: true
      })

      await stopFfmpeg(ffmpegCommand)
    })
  })

  describe('Without live transcoding', function () {
    let liveVideoId: string

    it('Should pass an Enhanced RTMP HEVC stream through', async function () {
      this.timeout(240000)

      await updateLiveConf(false)
      liveVideoId = await createLive(true)

      const ffmpegCommand = await servers[0].live.sendRTMPStreamInVideo({ videoId: liveVideoId, videoCodec: 'hevc' })
      await waitUntilLivePublishedOnAllServers(servers, liveVideoId)
      await waitJobs(servers)

      await testLiveVideoResolutions({
        originServer: servers[0],
        sqlCommand: sqlCommandServer1,
        servers,
        liveVideoId,
        resolutions: [ 720 ],
        transcoded: false
      })

      const video = await servers[0].videos.get({ id: liveVideoId })
      const probe = await ffprobePromise(video.streamingPlaylists[0].playlistUrl)
      const videoStream = probe.streams.find(s => s.codec_type === 'video')

      expect(videoStream.codec_name).to.equal('hevc')
      expect(videoStream.height).to.equal(720)

      await stopFfmpeg(ffmpegCommand)
    })

    it('Should save an HEVC replay playable by Apple players', async function () {
      this.timeout(240000)

      await waitUntilLiveReplacedByReplayOnAllServers(servers, liveVideoId)
      await waitJobs(servers)

      for (const server of servers) {
        const video = await server.videos.get({ id: liveVideoId })
        const hlsPlaylist = video.streamingPlaylists[0]

        expect(hlsPlaylist.files).to.have.lengthOf(1)

        const masterPlaylist = await server.streamingPlaylists.get({ url: hlsPlaylist.playlistUrl })
        // Audio is whatever the flv muxer defaults to (mp3 here), only the video codec matters
        expect(masterPlaylist).to.match(/CODECS="hvc1\.1\.6\.L\d+\.B0,mp4a\.40\.\d+"/)

        const probe = await ffprobePromise(hlsPlaylist.files[0].fileUrl)
        const videoStream = probe.streams.find(s => s.codec_type === 'video')

        expect(videoStream.codec_name).to.equal('hevc')
        expect(videoStream.codec_tag_string).to.equal('hvc1')
      }
    })
  })

  after(async function () {
    if (sqlCommandServer1) await sqlCommandServer1.cleanup()

    await cleanupTests(servers)
  })
})
