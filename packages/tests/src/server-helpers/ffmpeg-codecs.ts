/* oxlint-disable @typescript-eslint/no-unused-expressions,@typescript-eslint/require-await */

import { getVideoStreamCodec } from '@peertube/peertube-server/core/helpers/ffmpeg/codecs.js'
import { expect } from 'chai'
import { FfprobeData, FfprobeStream } from 'fluent-ffmpeg'

function buildProbe (stream: Partial<FfprobeStream>) {
  return { streams: [ { codec_type: 'video', ...stream } ], format: {}, chapters: [] } as FfprobeData
}

describe('FFmpeg codecs', function () {

  it('Should build an hvc1 codec string for HEVC Main', async function () {
    const probe = buildProbe({ codec_name: 'hevc', codec_tag_string: 'hvc1', profile: 'Main', level: 123 })

    expect(await getVideoStreamCodec('', probe)).to.equal('hvc1.1.6.L123.B0')
  })

  it('Should build an hvc1 codec string for HEVC Main 10', async function () {
    const probe = buildProbe({ codec_name: 'hevc', codec_tag_string: 'hvc1', profile: 'Main 10', level: 150 })

    expect(await getVideoStreamCodec('', probe)).to.equal('hvc1.2.4.L150.B0')
  })

  it('Should keep the hev1 tag and default to hvc1 for MPEG-TS input', async function () {
    const hev1 = buildProbe({ codec_name: 'hevc', codec_tag_string: 'hev1', profile: 'Main', level: 120 })
    expect(await getVideoStreamCodec('', hev1)).to.equal('hev1.1.6.L120.B0')

    const ts = buildProbe({ codec_name: 'hevc', codec_tag_string: '[36][0][0][0]', profile: 'Main', level: 120 })
    expect(await getVideoStreamCodec('', ts)).to.equal('hvc1.1.6.L120.B0')
  })

  it('Should fall back to Main for an unknown HEVC profile', async function () {
    const probe = buildProbe({ codec_name: 'hevc', codec_tag_string: 'hvc1', profile: 'Rext', level: 93 })

    expect(await getVideoStreamCodec('', probe)).to.equal('hvc1.1.6.L93.B0')
  })

  it('Should still build H.264 codec strings', async function () {
    const probe = buildProbe({ codec_name: 'h264', codec_tag_string: 'avc1', profile: 'High', level: 40 })

    expect(await getVideoStreamCodec('', probe)).to.equal('avc1.640028')
  })
})
