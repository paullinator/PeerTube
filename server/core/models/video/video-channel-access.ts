import { VideoChannelAccessMode, type VideoChannelAccessModeType } from '@peertube/peertube-models'
import { MChannelAccess } from '@server/types/models/index.js'
import { Transaction } from 'sequelize'
import { AllowNull, BelongsTo, Column, CreatedAt, Default, ForeignKey, Table, UpdatedAt } from 'sequelize-typescript'
import { SequelizeModel } from '../shared/index.js'
import { VideoChannelModel } from './video-channel.js'

@Table({
  tableName: 'videoChannelAccess',
  indexes: [
    {
      fields: [ 'channelId' ],
      unique: true
    }
  ]
})
export class VideoChannelAccessModel extends SequelizeModel<VideoChannelAccessModel> {
  @AllowNull(false)
  @Default(VideoChannelAccessMode.PUBLIC)
  @Column
  declare mode: VideoChannelAccessModeType

  // Per-channel secret used to sign access tokens. Rotating it revokes all issued access.
  @AllowNull(false)
  @Column
  declare tokenSecret: string

  @CreatedAt
  declare createdAt: Date

  @UpdatedAt
  declare updatedAt: Date

  @ForeignKey(() => VideoChannelModel)
  @Column
  declare channelId: number

  @BelongsTo(() => VideoChannelModel, {
    foreignKey: {
      allowNull: false
    },
    onDelete: 'cascade'
  })
  declare VideoChannel: Awaited<VideoChannelModel>

  static loadByChannelId (channelId: number, transaction?: Transaction): Promise<MChannelAccess> {
    return VideoChannelAccessModel.findOne({
      where: { channelId },
      transaction
    })
  }

  static async isRestricted (channelId: number): Promise<boolean> {
    const access = await VideoChannelAccessModel.findOne({
      attributes: [ 'mode' ],
      where: { channelId }
    })

    return !!access && access.mode === VideoChannelAccessMode.RESTRICTED
  }
}
