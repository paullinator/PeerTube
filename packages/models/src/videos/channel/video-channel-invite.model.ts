// Reusable invite link that grants access to a (restricted) channel and can enable sign-up.
export interface VideoChannelInvite {
  id: number
  code: string
  channelId: number

  // null = unlimited
  maxUses: number | null
  uses: number

  // null = never expires
  expiresAt: Date | string | null

  createdAt: Date | string
  updatedAt: Date | string
}

// Returned to channel managers (includes the shareable URL)
export interface VideoChannelInviteWithURL {
  id: number
  code: string
  channelId: number
  maxUses: number | null
  uses: number
  expiresAt: Date | string | null
  url: string
}

// Sent by a channel manager creating an invite (POST /:handle/invites)
export interface VideoChannelInviteCreate {
  maxUses?: number | null
  expiresAt?: Date | string | null
}

// Public info shown on the invite landing page (GET /video-channel-invites/:code)
export interface VideoChannelInviteInfo {
  valid: boolean

  channel: {
    name: string
    displayName: string
  }
}

// Result of redeeming an invite (POST /video-channel-invites/:code/redeem)
export interface VideoChannelInviteRedeemResult {
  channelHandle: string
}
