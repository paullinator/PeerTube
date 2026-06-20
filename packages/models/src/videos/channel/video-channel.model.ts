import { Account, ActorImage } from '../../actors/index.js'
import { Actor } from '../../actors/actor.model.js'
import { VideoChannelAccessModeType } from './video-channel-access.model.js'

export type ViewsPerDate = {
  date: Date
  views: number
}

export interface VideoChannel extends Actor {
  displayName: string
  description: string
  support: string
  isLocal: boolean

  updatedAt: Date | string

  ownerAccount?: Account

  videosCount?: number
  viewsPerDay?: ViewsPerDate[] // chronologically ordered
  totalViews?: number

  banners: ActorImage[]

  // Per-channel access control (undefined/PUBLIC for older servers and remote channels)
  accessMode?: VideoChannelAccessModeType
  requiresPassword?: boolean
  viewerHasAccess?: boolean
}

export interface VideoChannelSummary {
  id: number
  name: string
  displayName: string
  url: string
  host: string

  avatars: ActorImage[]
}

export function isVideoChannel (obj: Account | VideoChannel): obj is VideoChannel {
  return obj && typeof obj === 'object' && 'support' in obj
}
