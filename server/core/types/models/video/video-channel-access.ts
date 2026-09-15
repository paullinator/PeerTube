import { PickWith } from '@peertube/peertube-typescript-utils'
import { VideoChannelAccessModel } from '@server/models/video/video-channel-access.js'
import { VideoChannelAllowedAccountModel } from '@server/models/video/video-channel-allowed-account.js'
import { VideoChannelInviteModel } from '@server/models/video/video-channel-invite.js'
import { VideoChannelPasswordModel } from '@server/models/video/video-channel-password.js'
import { MAccountDefault } from '../account/account.js'

type UseAllowed<K extends keyof VideoChannelAllowedAccountModel, M> = PickWith<VideoChannelAllowedAccountModel, K, M>

// ############################################################################

export type MChannelAccess = Omit<VideoChannelAccessModel, 'VideoChannel'>
export type MChannelAccessId = Pick<MChannelAccess, 'id' | 'mode' | 'tokenSecret' | 'channelId'>

// ############################################################################

export type MChannelPassword = Omit<VideoChannelPasswordModel, 'VideoChannel'>

// ############################################################################

export type MChannelAllowedAccountBase = Omit<VideoChannelAllowedAccountModel, 'VideoChannel' | 'Account'>

export type MChannelAllowedAccount =
  & MChannelAllowedAccountBase
  & UseAllowed<'Account', MAccountDefault>

// ############################################################################

export type MChannelInvite = Omit<VideoChannelInviteModel, 'VideoChannel'>
