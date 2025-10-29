# WhatsApp Command Center v0.1.6

## 🚀 Major Improvements

This release focuses on fixing message detection issues and adding powerful new features for better monitoring and alerting.

## 🐛 Critical Fixes

### Fixed Message Detection Issues
- **Fixed:** Messages not appearing in fullscreen mode after WhatsApp Web DOM changes
- **Fixed:** Alert emoji (🚨) detection not working consistently
- **Fixed:** Flashing would restart after pressing 'S' to stop

### Technical Improvements
- **Added polling mechanism:** Messages are now checked every 2 seconds as a fallback to mutation observers
- **Updated DOM selectors:** Now properly detects messages using multiple fallback strategies
- **Improved message container detection:** Better handling of WhatsApp's dynamic DOM structure

## ✨ New Features

### Flash All New Messages
- **New checkbox** in the header next to "Fullscreen Mode" button
- When enabled, screen flashes red for **any** new message (not just alert emojis)
- Perfect for high-activity chats where you need to catch every message
- Setting is **persistent** - saved across app restarts

### Smart Alert Acknowledgment
- Press 'S' to stop flashing, and it **stays stopped** for that alert
- Only flashes again when a **new** alert emoji or message arrives
- Acknowledged alerts are tracked so you're not bothered repeatedly
- Automatically clears when new messages arrive or when exiting fullscreen

## 📊 Enhanced Logging & Debugging

- Better console logging for troubleshooting
- DOM diagnostics to understand WhatsApp Web structure
- Clear indicators when new messages are detected
- Logging for alert emoji detection and acknowledgment

## 🔄 How Polling Works

The app now uses a dual-detection system:
1. **Mutation Observer:** Catches immediate changes (instant detection)
2. **Polling Interval:** Checks every 2 seconds as backup (fallback detection)

This ensures messages are **always detected**, even if WhatsApp Web changes how they update the DOM.

## 📝 Usage

### Flash on All New Messages
1. Look for the checkbox next to "📺 Fullscreen Mode"
2. Check "Flash All New Messages"
3. Enter fullscreen mode
4. Any new message will now flash red

### Stop Flashing
- Press 'S' key to stop flashing
- Same alert won't trigger flashing again
- New messages or new alerts will trigger flashing

## 🔧 Technical Details

### Files Changed
- `renderer.js`: Major updates to message detection and flashing logic
- `package.json`: Version bump to 0.1.6

### Key Improvements
- Added `messagePollingInterval` for continuous monitoring
- Added `acknowledgedAlertMessages` Set to track stopped alerts
- Added `flashOnAllNewMessages` setting with localStorage persistence
- Improved `getMessageElements()` with multiple fallback selectors
- Enhanced `checkForAlertEmoji()` with acknowledgment tracking

## 📦 Installation

Download the appropriate package for your platform:
- **macOS:** `Mac-WhatsApp Command Center-0.1.6-universal.dmg`
- **Windows:** `Win-WhatsApp Command Center-Setup-0.1.6-x64.exe`

## 🙏 Feedback

If you encounter any issues or have suggestions, please open an issue on GitHub.

---

**Full Changelog**: https://github.com/crownemmanuel/whatsapp-command-center/compare/v0.1.5...v0.1.6

