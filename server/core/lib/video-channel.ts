import { VideoChannelCreate } from '@peertube/peertube-models'
import * as Sequelize from 'sequelize'
import { VideoChannelModel } from '../models/video/video-channel.js'
import { VideoModel } from '../models/video/video.js'
import { MAccountId, MChannelId } from '../types/models/index.js'
import { sequelizeTypescript } from '../initializers/database.js'
import { getLocalVideoChannelActivityPubUrl } from './activitypub/url.js'
import { canVideoBeFederated, federateVideoIfNeeded } from './activitypub/videos/index.js'
import { sendDeleteVideo } from './activitypub/send/send-delete.js'
import { buildActorInstance } from './local-actor.js'

export async function createLocalVideoChannelWithoutKeys (body: VideoChannelCreate, account: MAccountId, t: Sequelize.Transaction) {
  const channel = await VideoChannelModel.create({
    name: body.displayName,
    description: body.description,
    support: body.support,
    accountId: account.id
  }, { transaction: t })

  const url = getLocalVideoChannelActivityPubUrl(body.name)
  const actor = buildActorInstance('Group', url, body.name)
  actor.videoChannelId = channel.id
  await actor.save({ transaction: t })

  // No need to send this empty video channel to followers
  return Object.assign(channel, { Actor: actor })
}

export async function federateAllVideosOfChannel (videoChannel: MChannelId) {
  const videoIds = await VideoModel.getAllIdsFromChannel({ videoChannel, count: 1000 })

  for (const videoId of videoIds) {
    const video = await VideoModel.loadFull(videoId)

    await federateVideoIfNeeded(video, false)
  }
}

// When a channel becomes restricted, its videos must no longer live on remote instances
export async function unfederateAllVideosOfChannel (videoChannel: MChannelId) {
  const videoIds = await VideoModel.getAllIdsFromChannel({ videoChannel, count: 1000 })

  for (const videoId of videoIds) {
    const video = await VideoModel.loadFull(videoId)

    // Only previously-federated videos need an explicit delete sent to followers
    if (!canVideoBeFederated(video)) continue

    await sequelizeTypescript.transaction(t => sendDeleteVideo({ video, deleteForPrivacyChange: true, transaction: t }))
  }
}
