import { MChannelAllowedAccount } from '@server/types/models/index.js'
import { Transaction } from 'sequelize'
import { BelongsTo, Column, CreatedAt, ForeignKey, Scopes, Table, UpdatedAt } from 'sequelize-typescript'
import { AccountModel } from '../account/account.js'
import { doesExist, SequelizeModel } from '../shared/index.js'
import { VideoChannelModel } from './video-channel.js'

enum ScopeNames {
  WITH_ACCOUNT = 'WITH_ACCOUNT'
}

@Table({
  tableName: 'videoChannelAllowedAccount',
  indexes: [
    {
      fields: [ 'channelId', 'accountId' ],
      unique: true
    }
  ]
})
@Scopes(() => ({
  [ScopeNames.WITH_ACCOUNT]: {
    include: [
      {
        model: AccountModel,
        required: true
      }
    ]
  }
}))
export class VideoChannelAllowedAccountModel extends SequelizeModel<VideoChannelAllowedAccountModel> {
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

  @ForeignKey(() => AccountModel)
  @Column
  declare accountId: number

  @BelongsTo(() => AccountModel, {
    foreignKey: {
      allowNull: false
    },
    onDelete: 'cascade'
  })
  declare Account: Awaited<AccountModel>

  static listForChannel (channelId: number): Promise<MChannelAllowedAccount[]> {
    return VideoChannelAllowedAccountModel
      .scope([ ScopeNames.WITH_ACCOUNT ])
      .findAll({ where: { channelId } })
  }

  static deleteAllForChannel (channelId: number, transaction?: Transaction) {
    return VideoChannelAllowedAccountModel.destroy({ where: { channelId }, transaction })
  }

  static add (channelId: number, accountId: number, transaction?: Transaction) {
    return VideoChannelAllowedAccountModel.create({ channelId, accountId }, { transaction })
  }

  // Is the account behind this user allowed to access this channel?
  static isAllowedForUser (options: {
    userId: number
    channelId: number
  }): Promise<boolean> {
    const { userId, channelId } = options

    const query = `SELECT 1 FROM "videoChannelAllowedAccount" ` +
      `INNER JOIN "account" ON "account"."id" = "videoChannelAllowedAccount"."accountId" AND "account"."userId" = $userId ` +
      `WHERE "videoChannelAllowedAccount"."channelId" = $channelId ` +
      `LIMIT 1`

    return doesExist({
      sequelize: this.sequelize,
      query,
      bind: { userId, channelId }
    })
  }
}
