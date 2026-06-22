import { Component, OnInit, inject } from '@angular/core'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import { AuthService, Notifier } from '@app/core'
import { VideoChannelService } from '@app/shared/shared-main/channel/video-channel.service'

@Component({
  templateUrl: './video-channel-invite-landing.component.html',
  imports: [ RouterLink ]
})
export class VideoChannelInviteLandingComponent implements OnInit {
  private route = inject(ActivatedRoute)
  private router = inject(Router)
  private authService = inject(AuthService)
  private notifier = inject(Notifier)
  private channelService = inject(VideoChannelService)

  // Key reused after login to auto-redeem (mirrors the login-previous-url pattern)
  static SESSION_STORAGE_KEY = 'channel-invite-code'

  code: string
  channelDisplayName: string
  invalid = false
  loaded = false

  ngOnInit () {
    this.code = this.route.snapshot.params['code']

    this.channelService.getChannelInviteInfo(this.code)
      .subscribe({
        next: info => {
          this.channelDisplayName = info.channel.displayName
          this.loaded = true

          if (!info.valid) {
            this.invalid = true
            return
          }

          if (this.authService.isLoggedIn()) {
            this.redeem()
          } else {
            // Remember the code so we can redeem right after the user signs up or logs in
            sessionStorage.setItem(VideoChannelInviteLandingComponent.SESSION_STORAGE_KEY, this.code)
          }
        },

        error: () => {
          this.invalid = true
          this.loaded = true
        }
      })
  }

  isLoggedIn () {
    return this.authService.isLoggedIn()
  }

  goToSignup () {
    this.router.navigate([ '/signup' ], { queryParams: { channelInviteCode: this.code } })
  }

  goToLogin () {
    // The code is also kept in sessionStorage, but pass it along so a direct login (incl. OAuth) can redeem it
    this.router.navigate([ '/login' ], { queryParams: { channelInviteCode: this.code } })
  }

  private redeem () {
    this.channelService.redeemChannelInvite(this.code)
      .subscribe({
        next: ({ channelHandle }) => {
          sessionStorage.removeItem(VideoChannelInviteLandingComponent.SESSION_STORAGE_KEY)
          this.notifier.success($localize`You now have access to ${this.channelDisplayName}`)
          this.router.navigate([ '/c', channelHandle ])
        },

        error: err => {
          this.invalid = true
          this.notifier.handleError(err)
        }
      })
  }
}
