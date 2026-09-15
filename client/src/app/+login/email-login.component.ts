import { Component, OnInit, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import { AuthService, RedirectService } from '@app/core'
import { AlertComponent } from '@app/shared/shared-main/common/alert.component'
import { ServerConfig } from '@peertube/peertube-models'

@Component({
  selector: 'my-email-login',
  templateUrl: './email-login.component.html',
  imports: [ FormsModule, RouterLink, AlertComponent ]
})
export class EmailLoginComponent implements OnInit {
  private route = inject(ActivatedRoute)
  private router = inject(Router)
  private authService = inject(AuthService)
  private redirectService = inject(RedirectService)

  // request -> waiting for the user to enter the OTP (or click the email link); completing the magic link
  step: 'request' | 'sent' | 'completing' = 'request'

  email = ''
  otp = ''

  error: string = null
  loading = false

  private serverConfig: ServerConfig

  get instanceName () {
    return this.serverConfig?.instance?.name
  }

  get emailOnlyEnabled () {
    return this.serverConfig?.signup?.emailOnly === true
  }

  ngOnInit () {
    this.serverConfig = this.route.snapshot.data.serverConfig

    const params = this.route.snapshot.queryParams

    // Carry an invite code (from a /signup?channelInviteCode link) so it can be redeemed after login
    if (params.channelInviteCode) {
      sessionStorage.setItem('channel-invite-code', params.channelInviteCode)
    }

    // Magic link landing: auto-complete the login
    if (params.email && params.verificationString) {
      this.step = 'completing'
      this.email = params.email
      this.complete({ verificationString: params.verificationString })
      return
    }

    if (params.email) this.email = params.email
  }

  request () {
    if (!this.email) return

    this.error = null
    this.loading = true

    // Forward any pending invite code so the magic link carries it (the link opens a fresh
    // tab without this tab's sessionStorage, so it must travel through the URL)
    const channelInviteCode = sessionStorage.getItem('channel-invite-code') || undefined

    this.authService.emailLoginRequest(this.email, channelInviteCode)
      .subscribe({
        next: () => {
          this.loading = false
          this.step = 'sent'
        },

        error: err => {
          this.loading = false
          this.error = err.message
        }
      })
  }

  submitOtp () {
    if (!this.otp) return

    this.complete({ otp: this.otp })
  }

  private complete (options: { verificationString?: string, otp?: string }) {
    this.error = null
    this.loading = true

    this.authService.emailLoginComplete({ email: this.email, ...options })
      .subscribe({
        next: () => {
          this.loading = false

          // If the user arrived through a channel invite, route through the landing page to redeem it
          const inviteCode = sessionStorage.getItem('channel-invite-code')
          if (inviteCode) {
            sessionStorage.removeItem('channel-invite-code')
            this.router.navigate([ '/video-channels/invite', inviteCode ])
            return
          }

          this.redirectService.redirectToLatestSessionRoute()
        },

        error: err => {
          this.loading = false
          this.error = err.message
          // Allow the user to retry by asking a new link
          if (this.step === 'completing') this.step = 'request'
        }
      })
  }
}
