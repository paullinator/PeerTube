import { AccountSummary } from '../../actors/index.js'

export const VideoChannelAccessMode = {
  PUBLIC: 1,
  RESTRICTED: 2
} as const

export type VideoChannelAccessModeType = typeof VideoChannelAccessMode[keyof typeof VideoChannelAccessMode]

export interface VideoChannelPassword {
  id: number
  password: string
  channelId: number
  createdAt: Date | string
  updatedAt: Date | string
}

// Returned to channel managers (GET /:handle/access)
export interface VideoChannelAccess {
  mode: VideoChannelAccessModeType
  passwords: VideoChannelPassword[]
  allowedAccounts: AccountSummary[]
}

// Sent by channel managers (PUT /:handle/access)
export interface VideoChannelAccessUpdate {
  mode: VideoChannelAccessModeType
  passwords?: string[]
  allowedAccountNames?: string[]
}

// Sent by a viewer trying to unlock a restricted channel (POST /:handle/access/request)
export interface VideoChannelAccessRequest {
  password?: string
}
