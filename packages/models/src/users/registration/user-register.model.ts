export interface UserRegister {
  username: string
  password: string
  email: string

  displayName?: string

  channel?: {
    name: string
    displayName: string
  }

  // Optional reusable channel invite code: when valid, enables sign-up even if public
  // registration is disabled and grants the new account access to the channel.
  channelInviteCode?: string
}
