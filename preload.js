const { contextBridge, ipcRenderer } = require("electron");

// Expose specific Electron APIs to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  toggleFullscreen: () => ipcRenderer.send("toggle-full-screen"),

  // Log functions for inspection mode
  logElement: (data) => {
    console.log("ELEMENT INSPECTION:");
    console.log("====================");
    console.log(data);
    console.log("====================");
  },

  logInfo: (message) => console.log(`[WhatsApp Presentation] ${message}`),

  // Settings management
  updateSettings: (settings) => ipcRenderer.send("update-settings", settings),

  // Listen for config updates
  onConfigUpdate: (callback) => ipcRenderer.on("config-updated", callback),

  // Auto update functions
  checkForUpdates: () => ipcRenderer.send("check-for-updates"),
  downloadUpdate: () => ipcRenderer.send("download-update"),
  quitAndInstall: () => ipcRenderer.send("quit-and-install"),

  // Auto update events
  onUpdateDownloading: (callback) =>
    ipcRenderer.on("update-downloading", (event) => callback()),
  onUpdateProgress: (callback) =>
    ipcRenderer.on("update-download-progress", (event, progress) =>
      callback(progress)
    ),
  onUpdateDownloaded: (callback) =>
    ipcRenderer.on("update-downloaded", (event) => callback()),
  onUpdateError: (callback) =>
    ipcRenderer.on("update-error", (event, message) => callback(message)),
});
