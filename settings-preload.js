const { contextBridge, ipcRenderer } = require("electron");

// Expose specific Electron APIs to the settings window
contextBridge.exposeInMainWorld("settingsAPI", {
  // Update settings in main process
  saveSettings: (settings) => ipcRenderer.send("update-settings", settings),

  // Get current settings from main process
  getCurrentSettings: () => ipcRenderer.invoke("get-settings"),

  // Close the window
  closeWindow: () => ipcRenderer.send("close-settings-window"),

  // Check for updates
  checkForUpdates: () => ipcRenderer.send("check-for-updates"),
});
