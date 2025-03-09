// Configuration for WhatsApp Presentation App

module.exports = {
  // Set to true to enable inspection mode for debugging
  INSPECTION_MODE: false,

  // Set to true to open DevTools automatically when the app starts
  AUTO_OPEN_DEVTOOLS: false,

  // Configuration for presentation mode
  PRESENTATION: {
    // Number of recent messages to show in presentation mode
    MAX_MESSAGES: 5,

    // The emoji that triggers alert mode
    ALERT_EMOJI: "🚨",

    // Font size for messages in full screen mode (in pixels)
    MESSAGE_FONT_SIZE: 45,

    // Whether to pop up (highlight) messages with the alert emoji
    POPUP_ALERT_MESSAGES: true,
  },
};
