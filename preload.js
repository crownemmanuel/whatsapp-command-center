const { contextBridge, ipcRenderer } = require("electron");

// Expose specific Electron APIs to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  toggleFullscreen: () => ipcRenderer.send("toggle-fullscreen"),

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
});
