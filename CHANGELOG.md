# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
