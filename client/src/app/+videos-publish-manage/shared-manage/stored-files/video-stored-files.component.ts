import { Component, inject, OnDestroy, OnInit } from '@angular/core'
import { ConfirmService, Notifier, ServerService } from '@app/core'
import { VideoService } from '@app/shared/shared-main/video/video.service'
import { VideoState, VideoStoredFile } from '@peertube/peertube-models'
import { forkJoin } from 'rxjs'
import { GlobalIconComponent } from '../../../shared/shared-icons/global-icon.component'
import { AlertComponent } from '../../../shared/shared-main/common/alert.component'
import { BytesPipe } from '../../../shared/shared-main/common/bytes.pipe'
import { LoaderComponent } from '../../../shared/shared-main/common/loader.component'
import { VideoManageController } from '../video-manage-controller.service'

const REFRESH_INTERVAL_MS = 3000

@Component({
  selector: 'my-video-stored-files',
  styleUrls: [
    '../common/video-manage-page-common.scss',
    './video-stored-files.component.scss'
  ],
  templateUrl: './video-stored-files.component.html',
  imports: [
    GlobalIconComponent,
    AlertComponent,
    BytesPipe,
    LoaderComponent
  ]
})
export class VideoStoredFilesComponent implements OnInit, OnDestroy {
  private videoService = inject(VideoService)
  private manageController = inject(VideoManageController)
  private notifier = inject(Notifier)
  private confirmService = inject(ConfirmService)
  private server = inject(ServerService)

  files: VideoStoredFile[] = []
  loaded = false
  instanceName: string

  // The video is being processed (rebuild from the original, or any other transcoding)
  processing = false
  // The rebuild was started from this page
  rebuildRequested = false
  processingSince: Date
  lastRefreshAt: Date

  deletingOriginal = false

  private refreshTimeout: ReturnType<typeof setTimeout>
  private destroyed = false

  ngOnInit () {
    this.instanceName = this.server.getHTMLConfig().instance.name

    this.refresh({ ignoreLoadingBar: false })
  }

  ngOnDestroy () {
    this.destroyed = true

    if (this.refreshTimeout) clearTimeout(this.refreshTimeout)
  }

  hasOriginal () {
    return this.files.some(f => f.kind === 'original')
  }

  getKindLabel (file: VideoStoredFile) {
    if (file.kind === 'original') return $localize`Original`
    if (file.kind === 'hls') return $localize`HLS`

    return $localize`Web video`
  }

  getStorageLabel (file: VideoStoredFile) {
    return file.storage === 'object-storage'
      ? $localize`Object storage`
      : $localize`Disk`
  }

  formatBitrate (bitrate: number) {
    if (!bitrate) return '-'

    return (bitrate / 1_000_000).toFixed(1) + ' Mb/s'
  }

  getElapsed () {
    if (!this.processingSince) return ''

    const seconds = Math.round((Date.now() - this.processingSince.getTime()) / 1000)
    if (seconds < 60) return $localize`${seconds}s`

    return $localize`${Math.floor(seconds / 60)}m ${seconds % 60}s`
  }

  async copyOriginalToHLS () {
    const confirmed = await this.confirmService.confirm(
      $localize`The original file will be copied into HLS as is, without re-encoding.` +
        $localize` The other HLS resolutions and web video files of this video will be deleted.`,
      $localize`Rebuild HLS from the original file`
    )
    if (!confirmed) return

    const video = this.getVideo()

    this.rebuildRequested = true
    this.setProcessing(true)

    this.videoService.createHLSCopyFromSource({ video: { uuid: video.uuid, name: video.name } })
      .subscribe({
        next: () => this.scheduleRefresh(),

        error: err => {
          this.rebuildRequested = false
          this.setProcessing(false)
          this.notifier.handleError(err)
        }
      })
  }

  // An HLS file with the original's resolution, frame rate and codec: viewers keep full quality without the original
  hasFullQualityCopy () {
    const original = this.files.find(f => f.kind === 'original')
    if (!original) return false

    return this.files.some(f => {
      return f.kind === 'hls' &&
        f.height === original.height &&
        f.fps === original.fps &&
        f.videoCodec === original.videoCodec
    })
  }

  async deleteOriginal () {
    const message = this.hasFullQualityCopy()
      ? $localize`The original file will be permanently deleted from ${this.instanceName}.` +
        $localize` The HLS copy has the same video, so viewers are not affected.`
      : $localize`The original file will be permanently deleted from ${this.instanceName}.` +
        $localize` The files served to viewers are re-encoded at a lower quality,` +
        $localize` and this video can never be rebuilt from the original afterwards.` +
        $localize` Rebuild HLS from the original first to keep full quality.`

    const confirmed = await this.confirmService.confirm(message, $localize`Delete the original file`, {
      confirmButtonText: $localize`Delete`
    })
    if (!confirmed) return

    this.deletingOriginal = true

    this.videoService.removeSourceFile(this.getVideo().uuid)
      .subscribe({
        next: () => {
          this.deletingOriginal = false
          this.notifier.success($localize`The original file was deleted.`)

          this.refresh({ ignoreLoadingBar: false })
        },

        error: err => {
          this.deletingOriginal = false
          this.notifier.handleError(err)
        }
      })
  }

  // Refresh the file list and the video state; keep refreshing quietly while the video is processed
  private refresh (options: { ignoreLoadingBar: boolean }) {
    const uuid = this.getVideo().uuid

    forkJoin([
      this.videoService.getStoredFiles(uuid, options),
      this.videoService.getVideoState(uuid, options)
    ]).subscribe({
      next: ([ files, state ]) => {
        this.files = files
        this.loaded = true
        this.lastRefreshAt = new Date()

        const isProcessing = state === VideoState.TO_TRANSCODE

        if (this.processing && !isProcessing && this.rebuildRequested) {
          this.notifier.success($localize`The HLS copy of the original file is ready.`)
          this.rebuildRequested = false
        }

        this.setProcessing(isProcessing)

        if (isProcessing) this.scheduleRefresh()
      },

      error: err => {
        this.loaded = true
        this.notifier.handleError(err)

        // Keep trying while a rebuild is running, the server may just be busy
        if (this.processing) this.scheduleRefresh()
      }
    })
  }

  private scheduleRefresh () {
    if (this.destroyed) return
    if (this.refreshTimeout) clearTimeout(this.refreshTimeout)

    this.refreshTimeout = setTimeout(() => this.refresh({ ignoreLoadingBar: true }), REFRESH_INTERVAL_MS)
  }

  private setProcessing (processing: boolean) {
    if (processing && !this.processing) this.processingSince = new Date()
    if (!processing) this.processingSince = undefined

    this.processing = processing
  }

  private getVideo () {
    return this.manageController.getStore().videoEdit.getVideoAttributes()
  }
}
