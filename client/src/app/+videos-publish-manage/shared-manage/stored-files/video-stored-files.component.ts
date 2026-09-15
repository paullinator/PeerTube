import { Component, inject, OnDestroy, OnInit } from '@angular/core'
import { ConfirmService, Notifier, ServerService } from '@app/core'
import { VideoService } from '@app/shared/shared-main/video/video.service'
import { VideoStoredFile } from '@peertube/peertube-models'
import { GlobalIconComponent } from '../../../shared/shared-icons/global-icon.component'
import { AlertComponent } from '../../../shared/shared-main/common/alert.component'
import { BytesPipe } from '../../../shared/shared-main/common/bytes.pipe'
import { VideoManageController } from '../video-manage-controller.service'

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
    BytesPipe
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
  copying = false
  instanceName: string

  private pollTimeout: ReturnType<typeof setTimeout>

  ngOnInit () {
    this.instanceName = this.server.getHTMLConfig().instance.name

    this.loadFiles()
  }

  ngOnDestroy () {
    if (this.pollTimeout) clearTimeout(this.pollTimeout)
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

  async copyOriginalToHLS () {
    const confirmed = await this.confirmService.confirm(
      $localize`The original file will be copied into HLS as is, without re-encoding.` +
        $localize` The other HLS resolutions and web video files of this video will be deleted.`,
      $localize`Rebuild HLS from the original file`
    )
    if (!confirmed) return

    const video = this.getVideo()

    this.copying = true

    this.videoService.createHLSCopyFromSource({ video: { uuid: video.uuid, name: video.name } })
      .subscribe({
        next: () => {
          this.notifier.info($localize`Copying the original file into HLS...`)

          this.pollUntilCopied()
        },

        error: err => {
          this.copying = false
          this.notifier.handleError(err)
        }
      })
  }

  private loadFiles () {
    this.videoService.getStoredFiles(this.getVideo().uuid)
      .subscribe({
        next: files => {
          this.files = files
          this.loaded = true
        },

        error: err => {
          this.loaded = true
          this.notifier.handleError(err)
        }
      })
  }

  private pollUntilCopied (attempt = 0) {
    if (attempt >= 60) {
      this.copying = false
      this.notifier.info($localize`The copy is still running, reload this page later to see the result.`)
      return
    }

    this.pollTimeout = setTimeout(() => {
      this.videoService.getStoredFiles(this.getVideo().uuid)
        .subscribe({
          next: files => {
            this.files = files

            if (this.isCopyDone(files)) {
              this.copying = false
              this.notifier.success($localize`The HLS copy of the original file is ready.`)
              return
            }

            this.pollUntilCopied(attempt + 1)
          },

          error: err => {
            this.copying = false
            this.notifier.handleError(err)
          }
        })
    }, 3000)
  }

  private isCopyDone (files: VideoStoredFile[]) {
    const original = files.find(f => f.kind === 'original')
    const hls = files.filter(f => f.kind === 'hls')

    return !!original &&
      hls.length === 1 &&
      hls[0].height === original.height &&
      hls[0].videoCodec === original.videoCodec &&
      !files.some(f => f.kind === 'web-video')
  }

  private getVideo () {
    return this.manageController.getStore().videoEdit.getVideoAttributes()
  }
}
