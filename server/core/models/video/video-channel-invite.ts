import { randomInt } from 'crypto'
import { MChannelInvite } from '@server/types/models/index.js'
import { Op, Transaction } from 'sequelize'
import { AllowNull, BelongsTo, Column, CreatedAt, Default, ForeignKey, Table, UpdatedAt } from 'sequelize-typescript'
import { CHANNEL_INVITE } from '../../initializers/constants.js'
import { SequelizeModel } from '../shared/index.js'
import { VideoChannelModel } from './video-channel.js'

@Table({
  tableName: 'videoChannelInvite',
  indexes: [
    {
      fields: [ 'code' ],
      unique: true
    },
    {
      fields: [ 'channelId' ]
    }
  ]
})
export class VideoChannelInviteModel extends SequelizeModel<VideoChannelInviteModel> {
  @AllowNull(false)
  @Column
  declare code: string

  // null = unlimited uses
  @AllowNull(true)
  @Column
  declare maxUses: number

  @AllowNull(false)
  @Default(0)
  @Column
  declare uses: number

  // null = never expires
  @AllowNull(true)
  @Column
  declare expiresAt: Date

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

  // Bitcoin-style base58 alphabet (no 0, O, I, l to avoid visual ambiguity in short codes)
  private static readonly BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

  static generateCode () {
    let code = ''

    for (let i = 0; i < CHANNEL_INVITE.CODE_LENGTH; i++) {
      code += this.BASE58_ALPHABET[randomInt(this.BASE58_ALPHABET.length)]
    }

    return code
  }

  // Short codes can collide, so retry against the UNIQUE code column a few times
  static async generateUniqueCode () {
    for (let i = 0; i < 10; i++) {
      const code = this.generateCode()

      if (!await this.loadByCode(code)) return code
    }

    throw new Error('Could not generate a unique channel invite code')
  }

  static loadByCode (code: string, transaction?: Transaction): Promise<MChannelInvite> {
    return VideoChannelInviteModel.findOne({
      where: { code },
      transaction
    })
  }

  static loadByIdAndChannel (id: number, channelId: number): Promise<MChannelInvite> {
    return VideoChannelInviteModel.findOne({
      where: { id, channelId }
    })
  }

  static listForChannel (channelId: number): Promise<MChannelInvite[]> {
    return VideoChannelInviteModel.findAll({
      where: { channelId },
      order: [ [ 'createdAt', 'DESC' ] ]
    })
  }

  isRedeemable () {
    if (this.expiresAt && this.expiresAt.getTime() < Date.now()) return false
    if (this.maxUses !== null && this.maxUses !== undefined && this.uses >= this.maxUses) return false

    return true
  }

  incrementUses (transaction?: Transaction) {
    return VideoChannelInviteModel.increment('uses', {
      by: 1,
      where: { id: this.id },
      transaction
    })
  }

  static removeExpired () {
    return VideoChannelInviteModel.destroy({
      where: {
        expiresAt: { [Op.lt]: new Date() }
      }
    })
  }
}
