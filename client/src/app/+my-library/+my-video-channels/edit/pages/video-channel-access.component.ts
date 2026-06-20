import { DatePipe } from '@angular/common'
import { Component, inject, OnInit } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ConfirmService, Notifier } from '@app/core'
import { ActorAvatarComponent } from '@app/shared/shared-actor-image/actor-avatar.component'
import { UserAutoCompleteComponent } from '@app/shared/shared-forms/user-auto-complete.component'
import { GlobalIconComponent } from '@app/shared/shared-icons/global-icon.component'
import { ButtonComponent } from '@app/shared/shared-main/buttons/button.component'
import { CopyButtonComponent } from '@app/shared/shared-main/buttons/copy-button.component'
import { AlertComponent } from '@app/shared/shared-main/common/alert.component'
import { VideoChannelService } from '@app/shared/shared-main/channel/video-channel.service'
import {
  AccountSummary,
  VideoChannelAccessMode,
  VideoChannelAccessModeType,
  VideoChannelInviteWithURL
} from '@peertube/peertube-models'
import { VideoChannelEditControllerService } from '../video-channel-edit-controller.service'

@Component({
  selector: 'my-video-channel-access',
  templateUrl: './video-channel-access.component.html',
  styleUrls: [ './video-channel-access.component.scss' ],
  imports: [
    DatePipe,
    FormsModule,
    GlobalIconComponent,
    ButtonComponent,
    CopyButtonComponent,
    AlertComponent,
    ActorAvatarComponent,
    UserAutoCompleteComponent
  ]
})
export class VideoChannelAccessComponent implements OnInit {
  private channelService = inject(VideoChannelService)
  private notifier = inject(Notifier)
  private confirmService = inject(ConfirmService)
  private editController = inject(VideoChannelEditControllerService)

  readonly accessMode = VideoChannelAccessMode

  channelName: string

  mode: VideoChannelAccessModeType = VideoChannelAccessMode.PUBLIC
  passwords: string[] = []
  allowedAccounts: AccountSummary[] = []

  newPassword = ''
  newAccountUsername = ''

  invites: VideoChannelInviteWithURL[] = []
  newInviteMaxUses: number = null
  newInviteExpiresAt: string = null

  loaded = false

  ngOnInit () {
    this.channelName = this.editController.getStore().channel.name

    this.channelService.getChannelAccess(this.channelName)
      .subscribe({
        next: access => {
          this.mode = access.mode
          this.passwords = access.passwords.map(p => p.password)
          this.allowedAccounts = access.allowedAccounts
          this.loaded = true
        },

        error: err => this.notifier.handleError(err)
      })

    this.loadInvites()
  }

  isRestricted () {
    return this.mode === VideoChannelAccessMode.RESTRICTED
  }

  // ---------------------------------------------------------------------------

  addPassword () {
    const password = this.newPassword?.trim()
    if (!password) return

    if (this.passwords.includes(password)) {
      this.notifier.error($localize`This password already exists`)
      return
    }

    this.passwords.push(password)
    this.newPassword = ''
  }

  removePassword (password: string) {
    this.passwords = this.passwords.filter(p => p !== password)
  }

  // ---------------------------------------------------------------------------

  addAccount () {
    const username = this.newAccountUsername?.trim()
    if (!username) return

    const name = username.split('@')[0]
    if (this.allowedAccounts.some(a => a.name === name)) {
      this.notifier.error($localize`This account is already allowed`)
      return
    }

    this.allowedAccounts.push({ id: 0, name, displayName: username, url: '', host: '', avatars: [] })
    this.newAccountUsername = ''
  }

  removeAccount (account: AccountSummary) {
    this.allowedAccounts = this.allowedAccounts.filter(a => a.name !== account.name)
  }

  // ---------------------------------------------------------------------------

  save () {
    this.channelService.updateChannelAccess(this.channelName, {
      mode: this.mode,
      passwords: this.passwords,
      allowedAccountNames: this.allowedAccounts.map(a => a.name)
    }).subscribe({
      next: () => this.notifier.success($localize`Channel access settings updated`),

      error: err => this.notifier.handleError(err)
    })
  }

  async revokeAll () {
    const message = $localize`This will sign out every viewer who unlocked this channel. They will need to enter the password again. Continue?`

    const res = await this.confirmService.confirm(message, $localize`Revoke all existing access`)
    if (!res) return

    this.channelService.rotateChannelAccess(this.channelName)
      .subscribe({
        next: () => this.notifier.success($localize`All existing channel access has been revoked`),

        error: err => this.notifier.handleError(err)
      })
  }

  // ---------------------------------------------------------------------------
  // Invite links

  private loadInvites () {
    this.channelService.listChannelInvites(this.channelName)
      .subscribe({
        next: ({ data }) => this.invites = data,

        error: err => this.notifier.handleError(err)
      })
  }

  createInvite () {
    this.channelService.createChannelInvite(this.channelName, {
      maxUses: this.newInviteMaxUses || null,
      expiresAt: this.newInviteExpiresAt || null
    }).subscribe({
      next: invite => {
        this.invites.unshift(invite)
        this.newInviteMaxUses = null
        this.newInviteExpiresAt = null
        this.notifier.success($localize`Invite link created`)
      },

      error: err => this.notifier.handleError(err)
    })
  }

  async removeInvite (invite: VideoChannelInviteWithURL) {
    const res = await this.confirmService.confirm(
      $localize`This invite link will stop working. Continue?`,
      $localize`Revoke invite link`
    )
    if (!res) return

    this.channelService.removeChannelInvite(this.channelName, invite.id)
      .subscribe({
        next: () => {
          this.invites = this.invites.filter(i => i.id !== invite.id)
          this.notifier.success($localize`Invite link revoked`)
        },

        error: err => this.notifier.handleError(err)
      })
  }

  inviteUsesLabel (invite: VideoChannelInviteWithURL) {
    if (invite.maxUses) return `${invite.uses} / ${invite.maxUses}`

    return `${invite.uses}`
  }
}
