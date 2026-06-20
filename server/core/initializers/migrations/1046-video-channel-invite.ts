import * as Sequelize from 'sequelize'

async function up (utils: {
  transaction: Sequelize.Transaction
  queryInterface: Sequelize.QueryInterface
  sequelize: Sequelize.Sequelize
}): Promise<void> {
  // Reusable channel invite links. Additive table: older code that never reads it keeps working.
  const query = `CREATE TABLE IF NOT EXISTS "videoChannelInvite" (
  "id" SERIAL,
  "code" VARCHAR(255) NOT NULL UNIQUE,
  "channelId" INTEGER NOT NULL REFERENCES "videoChannel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "maxUses" INTEGER,
  "uses" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP WITH TIME ZONE,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
  PRIMARY KEY ("id")
)`

  await utils.sequelize.query(query, { transaction: utils.transaction })
}

function down (options) {
  throw new Error('Not implemented.')
}

export {
  up,
  down
}
