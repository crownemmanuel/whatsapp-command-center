# WhatsApp Command Center

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![Version](https://img.shields.io/badge/version-0.1.0-blue)

WhatsApp Command Center is a WhatsApp desktop app designed for production rooms and control rooms that have a workflow for using WhatsApp to send messages during productions and live events. They display WhatsApp messages from a particular group in full screen mode so it's legibly visible across the room. And users can tag certain messages to trigger the attention of people in the control room.

## 🌟 Features

- **Presentation Mode**: Display WhatsApp messages in full-screen with large, readable fonts
- **Alert System**: Messages with the 🚨 emoji reaction will cause the screen to flash red
- **Command Controls**: Easily manage communications in control room or production environments
- **Easy to Use**: Simple interface with a "Present" button added to WhatsApp's chat header
- **Cross-Platform**: Works on Windows, macOS, and Linux

## 📥 Download

Get the latest version of WhatsApp Command Center from our [releases page](https://github.com/crownemmanuel/whatsapp-command-center/releases).

### Windows

- [Installer (exe)](https://github.com/crownemmanuel/whatsapp-command-center/releases/download/v0.1.0/WhatsApp.Command.Center.Setup.0.1.0.exe)
- [Portable (exe)](https://github.com/crownemmanuel/whatsapp-command-center/releases/download/v0.1.0/WhatsApp.Command.Center.0.1.0.exe)

### macOS

- [Disk Image (dmg)](https://github.com/crownemmanuel/whatsapp-command-center/releases/download/v0.1.0/WhatsApp.Command.Center-0.1.0-arm64.dmg)
- [Zip Archive](https://github.com/crownemmanuel/whatsapp-command-center/releases/download/v0.1.0/WhatsApp.Command.Center-0.1.0-arm64-mac.zip)

### Linux

- [AppImage](https://github.com/crownemmanuel/whatsapp-command-center/releases/download/v0.1.0/WhatsApp.Command.Center-0.1.0-arm64.AppImage)
- [Debian Package](https://github.com/crownemmanuel/whatsapp-command-center/releases/download/v0.1.0/whatsapp-control-center_0.1.0_arm64.deb)

## 📋 Requirements

- Node.js 16.x or later
- npm 8.x or later
- Internet connection for WhatsApp Web

## 🚀 Installation

### From Source

1. Clone this repository

   ```
   git clone https://github.com/crownemmanuel/whatsapp-command-center.git
   cd whatsapp-command-center
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Start the application:
   ```
   npm start
   ```

### Pre-built Binaries

Download the latest release for your platform from the [Releases](https://github.com/crownemmanuel/whatsapp-command-center/releases) page.

## 🎮 Usage

1. Launch the application
2. Scan the QR code to log into WhatsApp Web
3. Open a group chat you want to present
4. Click the "📺 Present" button in the chat header
5. The presentation mode will open in full-screen
6. New messages will automatically appear in large text
7. If someone reacts to a message with 🚨, the screen will flash red
8. Click "Stop Flashing" to stop the alert
9. Click "Exit" to leave presentation mode

## 🔧 Inspection Mode

The app includes an inspection mode for debugging and identifying WhatsApp Web components. To use it:

1. Enable inspection mode in `config.js` by setting `INSPECTION_MODE: true`
2. Restart the app
3. Click the "🔍 Inspect" button in the chat header or press `Ctrl+Shift+I`
4. Click on any element in the WhatsApp Web interface to inspect it
5. Check the Developer Tools console for detailed information about the clicked element
6. Click the button again to exit inspection mode

The inspection mode shows:

- Element tag name, ID, and classes
- All attributes and data attributes
- XPath and CSS selector for the element
- Element position and dimensions
- Element text content

## ⚙️ Configuration

The application can be configured using the `config.js` file:

```javascript
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
    MESSAGE_FONT_SIZE: 65,

    // Whether to pop up (highlight) messages with the alert emoji
    POPUP_ALERT_MESSAGES: true,
  },
};
```

## 🏗️ Building for Production

To build the application for distribution:

```
npm run build
```

This will create installable packages in the `dist` directory for Windows, macOS, and Linux.

## 🤝 Contributing

Contributions are welcome! Please see our [Contributing Guidelines](CONTRIBUTING.md) for more details.

## 📃 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔒 Privacy

This application does not store or transmit any message data. All communication is handled directly between your computer and WhatsApp's servers through the WhatsApp Web interface.

## ⚠️ Disclaimer

This app is not affiliated with WhatsApp or Meta. It is an independent tool that enhances the WhatsApp Web interface for specific use cases. Use at your own risk and responsibility.
