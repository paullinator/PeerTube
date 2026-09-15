import { FfprobeData } from 'fluent-ffmpeg'
import { getAudioStream, getVideoStream } from '@peertube/peertube-ffmpeg'
import { logger } from '../logger.js'
import { forceNumber } from '@peertube/peertube-core-utils'

export async function getVideoStreamCodec (path: string, existingProbe?: FfprobeData) {
  const videoStream = await getVideoStream(path, existingProbe)
  if (!videoStream) return ''

  const videoCodec = videoStream.codec_tag_string

  if (videoCodec === 'vp09') return 'vp09.00.50.08'
  if (videoStream.codec_name === 'hevc') return getHEVCCodec(videoStream)

  const baseProfileMatrix = {
    avc1: {
      High: '6400',
      Main: '4D40',
      Baseline: '42E0'
    },
    av01: {
      High: '1',
      Main: '0',
      Professional: '2'
    }
  }

  let baseProfile = baseProfileMatrix[videoCodec][videoStream.profile]
  if (!baseProfile) {
    logger.warn('Cannot get video profile codec of %s.', path, { videoStream })
    baseProfile = baseProfileMatrix[videoCodec]['High'] // Fallback
  }

  if (videoCodec === 'av01') {
    let level = videoStream.level.toString()
    if (level.length === 1) level = `0${level}`

    // Guess the tier indicator and bit depth
    return `${videoCodec}.${baseProfile}.${level}M.08`
  }

  let level = forceNumber(videoStream.level).toString(16)
  if (level.length === 1) level = `0${level}`

  // Default, h264 codec
  return `${videoCodec}.${baseProfile}${level}`
}

// RFC 6381 / ISO 14496-15 codec string, assuming Main tier and no constraint flags
function getHEVCCodec (videoStream: { codec_tag_string?: string, profile?: string | number, level?: string | number }) {
  // Players need hvc1 unless the file really stores parameter sets in-band (hev1)
  const tag = videoStream.codec_tag_string === 'hev1'
    ? 'hev1'
    : 'hvc1'

  // Profile idc and its compatibility flags (hex): Main 1/6, Main 10 2/4, Main Still Picture 3/8
  const profiles: Record<string, string> = {
    'Main': '1.6',
    'Main 10': '2.4',
    'Main Still Picture': '3.8'
  }

  let profile = profiles[videoStream.profile + '']
  if (!profile) {
    logger.warn('Cannot get HEVC profile codec, fallback to Main.', { videoStream })
    profile = profiles['Main']
  }

  // ffprobe reports general_level_idc, which is 30 times the level number (4.1 -> 123)
  const level = forceNumber(videoStream.level) > 0
    ? forceNumber(videoStream.level)
    : 123

  return `${tag}.${profile}.L${level}.B0`
}

export async function getAudioStreamCodec (path: string, existingProbe?: FfprobeData) {
  const { audioStream } = await getAudioStream(path, existingProbe)

  if (!audioStream) return ''

  const audioCodecName = audioStream.codec_name

  if (audioCodecName === 'opus') return 'opus'
  if (audioCodecName === 'vorbis') return 'vorbis'
  if (audioCodecName === 'aac') return 'mp4a.40.2'
  if (audioCodecName === 'mp3') return 'mp4a.40.34'

  logger.warn('Cannot get audio codec of %s.', path, { audioStream })

  return 'mp4a.40.2' // Fallback
}
