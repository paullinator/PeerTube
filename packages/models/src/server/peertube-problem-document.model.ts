import { HttpStatusCodeType } from '../http/http-status-codes.js'
import { OAuth2ErrorCodeType, ServerErrorCodeType } from './server-error-code.enum.js'

export interface PeerTubeProblemDocumentData {
  'invalid-params'?: Record<string, object>

  originUrl?: string

  keyId?: string

  targetUrl?: string

  actorUrl?: string

  // Feeds
  format?: string
  url?: string

  // Restricted channel access: handle of the channel the viewer must unlock
  channel?: string
}

export interface PeerTubeProblemDocument extends PeerTubeProblemDocumentData {
  type: string
  title: string

  detail: string

  status: HttpStatusCodeType

  docs?: string
  code?: OAuth2ErrorCodeType | ServerErrorCodeType
}
