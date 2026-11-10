// Migration 039 is the source of truth; runtime requests never change schema.
async function ensureRestockNotificationsSchema(client) {
  await client.query('SELECT color_key, claim_token, unsubscribe_token FROM restock_notifications LIMIT 0');
}
module.exports = { ensureRestockNotificationsSchema };
