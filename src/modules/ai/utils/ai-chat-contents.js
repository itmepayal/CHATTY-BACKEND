const CHAT_HISTORY_LIMIT = 10;
const CHAT_MESSAGE_MAX = 400;

const buildChatContents = (messages) => {
  if (!Array.isArray(messages)) return [];

  const contents = messages
    .filter(
      (message) =>
        (message?.role === "user" || message?.role === "assistant") &&
        typeof message?.content === "string" &&
        message.content.trim().length > 0,
    )
    .slice(-CHAT_HISTORY_LIMIT)
    .map((message) => ({
      role: message.role === "user" ? "user" : "model",
      parts: [{ text: message.content.slice(0, CHAT_MESSAGE_MAX) }],
    }));

  while (contents.length && contents[0].role !== "user") contents.shift();
  return contents;
};

export default buildChatContents;
