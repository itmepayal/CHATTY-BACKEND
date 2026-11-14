export const prefsPayload = (user) => ({
  showOnlineStatus: user.showOnlineStatus !== false,
  readReceipts: user.readReceipts !== false,
  typingIndicator: user.typingIndicator !== false,

  enterToSend: user.enterToSend !== false,
  largeEmoji: user.largeEmoji !== false,
  autoScroll: user.autoScroll !== false,

  theme: user.theme ?? user.appearanceTheme ?? "light",
  fontSize: user.fontSize ?? user.appearanceFontSize ?? "md",
  bubbleStyle: user.bubbleStyle ?? user.appearanceBubbleStyle ?? "rounded",
  density: user.density ?? user.appearanceDensity ?? "comfortable",
  showTimestamps: (user.showTimestamps ?? user.appearanceTimestamps) !== false,
  timeFormat: user.timeFormat ?? user.appearanceTimeFormat ?? "12h",

  appearanceTheme: user.theme ?? user.appearanceTheme ?? "light",
  appearanceFontSize: user.fontSize ?? user.appearanceFontSize ?? "md",
  appearanceBubbleStyle: user.bubbleStyle ?? user.appearanceBubbleStyle ?? "rounded",
  appearanceDensity: user.density ?? user.appearanceDensity ?? "comfortable",
  appearanceTimestamps: (user.showTimestamps ?? user.appearanceTimestamps) !== false,
  appearanceTimeFormat: user.timeFormat ?? user.appearanceTimeFormat ?? "12h",
});
