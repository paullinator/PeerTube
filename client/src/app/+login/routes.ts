import { Routes } from '@angular/router'
import { ServerConfigResolver } from '@app/core/routing/server-config-resolver.service'
import { EmailLoginComponent } from './email-login.component'
import { LoginComponent } from './login.component'

export default [
  {
    path: '',
    component: LoginComponent,
    data: {
      meta: {
        title: $localize`Login`
      }
    },
    providers: [ ServerConfigResolver ],
    resolve: {
      serverConfig: ServerConfigResolver
    }
  },
  {
    path: 'email',
    component: EmailLoginComponent,
    data: {
      meta: {
        title: $localize`Email login`
      }
    },
    providers: [ ServerConfigResolver ],
    resolve: {
      serverConfig: ServerConfigResolver
    }
  }
] satisfies Routes
