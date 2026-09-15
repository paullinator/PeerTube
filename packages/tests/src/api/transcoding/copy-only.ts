/* oxlint-disable @typescript-eslint/no-unused-expressions,@typescript-eslint/require-await */

import { ffprobePromise } from '@peertube/peertube-ffmpeg'
import { VideoState } from '@peertube/peertube-models'
import { buildAbsoluteFixturePath } from '@peertube/peertube-node-utils'
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

describe('Test transcoding copy only', function () {
  let server: PeerTubeServer
  const hevcFixture = join(tmpdir(), 'peertube-copy-only-hevc-1080p60.mp4')

  async function uploadAndCheck (options: {
    fixture: string
    height: number
    fps: number
    codec: string
    codecTag: string
    codecsRegex: RegExp
  }) {
    const { uuid } = await server.videos.upload({ attributes: { name: 'copy only', fixture: options.fixture } })
    await waitJobs([ server ])

    const video = await server.videos.get({ id: uuid })
    expect(video.state.id).to.equal(VideoState.PUBLISHED)

    // No web video, no audio-only podcast file, no lower resolution
    expect(video.files).to.have.lengthOf(0)
    expect(video.streamingPlaylists).to.have.lengthOf(1)

    const files = video.streamingPlaylists[0].files
    expect(files).to.have.lengthOf(1)
    expect(files[0].resolution.id).to.equal(options.height)
    expect(files[0].fps).to.equal(options.fps)

    const probe = await ffprobePromise(files[0].fileUrl)
    const videoStream = probe.streams.find(s => s.codec_type === 'video')
    expect(videoStream.codec_name).to.equal(options.codec)
    expect(videoStream.codec_tag_string).to.equal(options.codecTag)
    expect(videoStream.height).to.equal(options.height)

    const masterPlaylist = await server.streamingPlaylists.get({ url: video.streamingPlaylists[0].playlistUrl })
    expect(masterPlaylist).to.match(options.codecsRegex)

    expect(await videoStreamHash(files[0].fileUrl)).to.equal(await videoStreamHash(buildAbsoluteFixturePath(options.fixture)))
  }

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
        copy_only: true,
        always_transcode_original_resolution: false,
        always_transcode_podcast_optimized_audio: true,
        resolutions: {
          '0p': true,
          '360p': true,
          '720p': true
        },
        web_videos: { enabled: false },
        hls: { enabled: true }
      }
    })

    await setAccessTokensToServers([ server ])
    await setDefaultVideoChannel([ server ])
  })

  it('Should copy an HEVC upload into HLS without re-encoding it', async function () {
    this.timeout(240_000)

    await uploadAndCheck({
      fixture: hevcFixture,
      height: 1080,
      fps: 60,
      codec: 'hevc',
      codecTag: 'hvc1',
      codecsRegex: /CODECS="hvc1\.1\.6\.L\d+\.B0,mp4a\.40\.2"/
    })
  })

  it('Should copy an H.264 upload into HLS without re-encoding it', async function () {
    this.timeout(240_000)

    await uploadAndCheck({
      fixture: '1080p_60fps.mp4',
      height: 1080,
      fps: 60,
      codec: 'h264',
      codecTag: 'avc1',
      codecsRegex: /CODECS="avc1\.[0-9A-F]{6},mp4a\.40\.2"/i
    })
  })

  after(async function () {
    await cleanupTests([ server ])
  })
})
