# WhatsApp Command Center Build Instructions

This document provides detailed instructions for building WhatsApp Command Center for different platforms.

## Prerequisites

- Node.js (v14 or later)
- npm (v6 or later)
- Git

## Initial Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/crownemmanuel/whatsapp-command-center.git
   cd whatsapp-command-center
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Building for Specific Platforms

### Building for Windows Only

Windows builds can be problematic when building from macOS or Linux. To ensure successful Windows builds:

```bash
# Build only for Windows (both x64 and arm64)
npx electron-builder --win

# Build for specific Windows architecture
npx electron-builder --win --x64  # For 64-bit Intel/AMD
npx electron-builder --win --arm64  # For ARM64
```

**Note**: Use `npx electron-builder` instead of `npm run build` when targeting specific platforms to avoid potential issues with shell script parameter passing.

### Building for macOS Only

```bash
# Build for all macOS variants (universal, x64, arm64)
npx electron-builder --mac --universal

# Build for specific macOS architecture
npx electron-builder --mac --x64  # For Intel Macs
npx electron-builder --mac --arm64  # For Apple Silicon
```

### Building for Linux Only

```bash
# Build for all Linux architectures
npx electron-builder --linux --x64 --arm64

# Build for specific Linux architecture
npx electron-builder --linux --x64  # For 64-bit Intel/AMD
npx electron-builder --linux --arm64  # For ARM64
```

## Building for All Platforms

To build for all platforms (may encounter issues on some systems):

```bash
npm run build
```

## Troubleshooting Common Build Issues

### Windows Build Issues on macOS

When building Windows packages on macOS:

1. Ensure Wine is installed if building on non-Windows platforms

   ```bash
   # On macOS
   brew install --cask wine-stable
   ```

2. If builds fail with errors about missing Windows dependencies, use platform-specific builds:

   ```bash
   # Try building only Windows
   npx electron-builder --win
   ```

3. If Linux universal builds fail, build specific architectures separately:
   ```bash
   npx electron-builder --linux --x64
   npx electron-builder --linux --arm64
   ```

### Code Signing Issues

If you encounter code signing issues:

- For development builds, you can disable code signing by adding `--publish=never` flag
- For production, ensure your code signing certificates are properly configured

## Release Process

1. Update version in `package.json`
2. Update release notes in a file like `release-notes-v{VERSION}.md`
3. Commit changes and tag the release:
   ```bash
   git commit -am "Release v{VERSION}"
   git tag v{VERSION}
   git push origin main --tags
   ```
4. Build the application for all platforms:
   ```bash
   npx electron-builder --win
   npx electron-builder --mac --universal
   npx electron-builder --linux --x64 --arm64
   ```
5. Create a GitHub release:
   ```bash
   gh release create v{VERSION} --title "WhatsApp Command Center v{VERSION}" --notes-file release-notes-v{VERSION}.md ./dist/{platform-prefix}*
   ```

## Artifact Naming Convention

Our build configuration in `package.json` uses platform prefixes for clarity:

- Windows: `Windows-WhatsApp Command Center-{version}-{arch}.exe`
- macOS: `macOS-WhatsApp Command Center-{version}-{arch}.dmg/zip`
- Linux: `Linux-WhatsApp Command Center-{version}-{arch}.AppImage/deb`

This naming convention makes it easier for users to identify the appropriate package for their system.
