export const prefsPayload = (user) => ({
  showOnlineStatus: user.showOnlineStatus !== false,
  readReceipts: user.readReceipts !== false,
  typingIndicator: user.typingIndicator !== false,

  enterToSend: user.enterToSend !== false,
  largeEmoji: user.largeEmoji !== false,
  autoScroll: user.autoScroll !== false,

  appearanceTheme: user.appearanceTheme ?? "light",
  appearanceFontSize: user.appearanceFontSize ?? "md",
  appearanceBubbleStyle: user.appearanceBubbleStyle ?? "rounded",
  appearanceDensity: user.appearanceDensity ?? "comfortable",
  appearanceTimestamps: user.appearanceTimestamps !== false,
  appearanceTimeFormat: user.appearanceTimeFormat ?? "12h",
});
