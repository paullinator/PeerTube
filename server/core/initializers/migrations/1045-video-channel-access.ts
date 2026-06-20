import * as Sequelize from 'sequelize'

async function up (utils: {
  transaction: Sequelize.Transaction
  queryInterface: Sequelize.QueryInterface
  sequelize: Sequelize.Sequelize
}): Promise<void> {
  // Per-channel access policy. Absence of a row = PUBLIC (default), so older code that
  // never reads this table keeps serving the channel publicly (backwards compatible).
  {
    const query = `CREATE TABLE IF NOT EXISTS "videoChannelAccess" (
  "id" SERIAL,
  "mode" INTEGER NOT NULL DEFAULT 1,
  "tokenSecret" VARCHAR(255) NOT NULL,
  "channelId" INTEGER NOT NULL UNIQUE REFERENCES "videoChannel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  PRIMARY KEY ("id")
)`

    await utils.sequelize.query(query, { transaction: utils.transaction })
  }

  // Channel passwords (multiple allowed), mirrors the videoPassword table
  {
    const query = `CREATE TABLE IF NOT EXISTS "videoChannelPassword" (
  "id" SERIAL,
  "password" VARCHAR(255) NOT NULL,
  "channelId" INTEGER NOT NULL REFERENCES "videoChannel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  PRIMARY KEY ("id")
)`

    await utils.sequelize.query(query, { transaction: utils.transaction })
  }

  // Accounts explicitly allowed to access a restricted channel
  {
    const query = `CREATE TABLE IF NOT EXISTS "videoChannelAllowedAccount" (
  "id" SERIAL,
  "channelId" INTEGER NOT NULL REFERENCES "videoChannel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "accountId" INTEGER NOT NULL REFERENCES "account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("channelId", "accountId")
)`

    await utils.sequelize.query(query, { transaction: utils.transaction })
  }
}

function down (options) {
  throw new Error('Not implemented.')
}

export {
  up,
  down
}
