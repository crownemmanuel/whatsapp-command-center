# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.6] - 2025-10-29

### Added

- Polling mechanism that checks for new messages every 2 seconds as fallback
- "Flash All New Messages" checkbox - flashes red for any new message, not just alert emojis
- Smart alert acknowledgment system - press 'S' to stop flashing and it stays stopped for that alert
- Persistent setting for "Flash All New Messages" using localStorage
- Enhanced logging for better debugging and troubleshooting
- DOM diagnostics to understand WhatsApp Web structure
- Multiple fallback selectors for better message detection

### Fixed

- Messages not appearing in fullscreen mode after WhatsApp Web DOM changes
- Alert emoji (🚨) detection not working consistently
- Flashing restarting after pressing 'S' to stop
- Message container not being found due to outdated selectors

### Changed

- Improved message detection with dual-detection system (mutation observer + polling)
- Updated DOM selectors to match current WhatsApp Web structure
- Enhanced `getMessageElements()` function with multiple fallback strategies
- Better error handling and logging throughout

## [0.1.3] - 2024-03-09

### Added

- Multi-architecture support for all platforms
- x64 (Intel) architecture builds for Windows
- Universal binary support for macOS
- x64 architecture support for Linux builds

### Changed

- Updated build configuration to support multiple architectures per platform
- Improved artifact naming for better architecture identification

## [0.1.2] - 2024-03-09

### Fixed

- Application startup issues in production builds
- Resource path handling for bundled assets
- Console message handling error

### Added

- Robust error handling and logging throughout the application
- Improved splash screen with fallback for missing assets
- Proper resource bundling configuration

### Changed

- Enhanced build configuration to exclude unnecessary files
- Improved logging for easier troubleshooting

## [0.1.1] - 2023-12-15

### Added

- Initial release of WhatsApp Command Center
- Presentation mode for displaying WhatsApp messages in full-screen
- Alert system with red flashing for messages with 🚨 emoji reaction
- Easy-to-use interface with a "Present" button in the chat header
- Cross-platform support for Windows, macOS, and Linux
- Inspection mode for debugging and identifying WhatsApp Web components
