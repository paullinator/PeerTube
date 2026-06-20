import { ResultList, VideoChannelPassword } from '@peertube/peertube-models'
import { pick } from '@peertube/peertube-core-utils'
import { isVideoChannelPasswordValid } from '@server/helpers/custom-validators/video-channels.js'
import { MChannelPassword } from '@server/types/models/index.js'
import { Transaction } from 'sequelize'
import { AllowNull, BelongsTo, Column, CreatedAt, ForeignKey, Is, Table, UpdatedAt } from 'sequelize-typescript'
import { SequelizeModel, getSort, throwIfNotValid } from '../shared/index.js'
import { VideoChannelModel } from './video-channel.js'

@Table({
  tableName: 'videoChannelPassword',
  indexes: [
    {
      fields: [ 'channelId' ]
    }
  ]
})
export class VideoChannelPasswordModel extends SequelizeModel<VideoChannelPasswordModel> {
  @AllowNull(false)
  @Is('VideoChannelPassword', value => throwIfNotValid(value, isVideoChannelPasswordValid, 'channelPassword'))
  @Column
  declare password: string

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

  static countByChannelId (channelId: number, t?: Transaction) {
    return VideoChannelPasswordModel.count({ where: { channelId }, transaction: t })
  }

  static async listPasswords (options: {
    start: number
    count: number
    sort: string
    channelId: number
  }): Promise<ResultList<MChannelPassword>> {
    const { start, count, sort, channelId } = options

    const { count: total, rows: data } = await VideoChannelPasswordModel.findAndCountAll({
      where: { channelId },
      order: getSort(sort),
      offset: start,
      limit: count
    })

    return { total, data }
  }

  static listAllForChannel (channelId: number, t?: Transaction): Promise<MChannelPassword[]> {
    return VideoChannelPasswordModel.findAll({ where: { channelId }, transaction: t })
  }

  static async addPasswords (passwords: string[], channelId: number, transaction?: Transaction): Promise<void> {
    for (const password of passwords) {
      await VideoChannelPasswordModel.create({ password, channelId }, { transaction })
    }
  }

  static deleteAllPasswords (channelId: number, transaction?: Transaction) {
    return VideoChannelPasswordModel.destroy({ where: { channelId }, transaction })
  }

  static deletePassword (passwordId: number, transaction?: Transaction) {
    return VideoChannelPasswordModel.destroy({ where: { id: passwordId }, transaction })
  }

  static async isACorrectPassword (options: {
    channelId: number
    password: string
  }) {
    const query = {
      where: pick(options, [ 'channelId', 'password' ])
    }

    return !!await VideoChannelPasswordModel.findOne(query)
  }

  toFormattedJSON (): VideoChannelPassword {
    return {
      id: this.id,
      password: this.password,
      channelId: this.channelId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    }
  }
}
