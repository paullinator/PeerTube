/* oxlint-disable @typescript-eslint/no-unused-expressions,@typescript-eslint/require-await */

import { VideoState } from '@peertube/peertube-models'
import {
  cleanupTests,
  createSingleServer,
  PeerTubeServer,
  setAccessTokensToServers,
  setDefaultVideoChannel,
  waitJobs
} from '@peertube/peertube-server-commands'
import { expect } from 'chai'
import { execFile } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// Hash of the video packets, identical only if the stream was copied without re-encoding
async function videoStreamHash (path: string) {
  const { stdout } = await execFileAsync('ffmpeg', [ '-v', 'error', '-i', path, '-map', '0:v', '-c', 'copy', '-f', 'hash', '-hash', 'md5', '-' ])

  return stdout.trim()
}

describe('Test video stored files', function () {
  let server: PeerTubeServer
  let videoUUID: string
  const hevcFixture = join(tmpdir(), 'peertube-stored-files-hevc-1080p60.mp4')

  before(async function () {
    this.timeout(120_000)

    await execFileAsync('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=60',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '4',
      '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'keyint=120:log-level=error', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1',
      '-c:a', 'aac',
      hevcFixture
    ])

    server = await createSingleServer(1, {
      transcoding: {
        enabled: true,
        copy_only: false,
        original_file: { keep: true },
        always_transcode_original_resolution: false,
        always_transcode_podcast_optimized_audio: false,
        resolutions: {
          '0p': false,
          '144p': false,
          '240p': false,
          '360p': false,
          '480p': false,
          '720p': true,
          '1080p': false,
          '1440p': false,
          '2160p': false
        },
        web_videos: { enabled: true },
        hls: { enabled: true }
      }
    })

    await setAccessTokensToServers([ server ])
    await setDefaultVideoChannel([ server ])

    const { uuid } = await server.videos.upload({ attributes: { name: 'stored files', fixture: hevcFixture } })
    videoUUID = uuid

    await waitJobs([ server ])
  })

  it('Should list the kept original and the re-encoded files', async function () {
    const files = await server.videos.getStoredFiles({ id: videoUUID })

    const original = files.find(f => f.kind === 'original')
    expect(original).to.exist
    expect(original.id).to.be.null
    expect(original.videoCodec).to.equal('hevc')
    expect(original.audioCodec).to.equal('aac')
    expect(original.resolution.id).to.equal(1080)
    expect(original.fps).to.equal(60)
    expect(original.size).to.be.above(0)
    expect(original.bitrate).to.be.above(0)
    expect(original.fileDownloadUrl).to.exist

    const hls = files.filter(f => f.kind === 'hls')
    expect(hls).to.have.lengthOf(1)
    expect(hls[0].resolution.id).to.equal(720)
    expect(hls[0].videoCodec).to.equal('h264')

    const webVideos = files.filter(f => f.kind === 'web-video')
    expect(webVideos).to.have.lengthOf(1)
    expect(webVideos[0].resolution.id).to.equal(720)
  })

  it('Should rebuild HLS by copying the kept original file', async function () {
    this.timeout(240_000)

    await server.videos.createHLSCopyFromSource({ id: videoUUID })
    await waitJobs([ server ])

    const video = await server.videos.get({ id: videoUUID })
    expect(video.state.id).to.equal(VideoState.PUBLISHED)
    expect(video.files).to.have.lengthOf(0)
    expect(video.streamingPlaylists[0].files).to.have.lengthOf(1)
    expect(video.streamingPlaylists[0].files[0].resolution.id).to.equal(1080)

    const files = await server.videos.getStoredFiles({ id: videoUUID })
    expect(files.filter(f => f.kind === 'original')).to.have.lengthOf(1)
    expect(files.filter(f => f.kind === 'web-video')).to.have.lengthOf(0)

    const hls = files.filter(f => f.kind === 'hls')
    expect(hls).to.have.lengthOf(1)
    expect(hls[0].resolution.id).to.equal(1080)
    expect(hls[0].videoCodec).to.equal('hevc')

    const hlsFileUrl = video.streamingPlaylists[0].files[0].fileUrl
    expect(await videoStreamHash(hlsFileUrl)).to.equal(await videoStreamHash(hevcFixture))

    const masterPlaylist = await server.streamingPlaylists.get({ url: video.streamingPlaylists[0].playlistUrl })
    expect(masterPlaylist).to.match(/CODECS="hvc1\.1\.6\.L\d+\.B0,mp4a\.40\.2"/)
  })

  after(async function () {
    await cleanupTests([ server ])
  })
})
