export const readProviderSession = (database, { chatId, provider }) => {
  const row = database
    .prepare(
      "SELECT payload FROM provider_sessions WHERE chat_id = ? AND provider = ?",
    )
    .get(chatId, provider);
  return row ? JSON.parse(row.payload) : null;
};

export function saveProviderSession(database, { chatId, provider, session }) {
  // A deletion can overtake a finishing turn; never recreate its catalog rows.
  if (
    !database
      .prepare("SELECT id FROM chats WHERE id = ? AND deleted_at IS NULL")
      .get(chatId)
  )
    return false;
  database
    .prepare(
      "INSERT INTO provider_sessions (chat_id, provider, payload) VALUES (?, ?, ?) ON CONFLICT(chat_id, provider) DO UPDATE SET payload = excluded.payload",
    )
    .run(chatId, provider, JSON.stringify(session));
  return true;
}
