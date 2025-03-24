const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  Menu,
  dialog,
} = require("electron");
const path = require("path");
const fs = require("fs");
const config = require("./config");
const { autoUpdater } = require("electron-updater");
const Store = require("electron-store");

// Set up enhanced logging
const log = require("electron-log");
log.transports.file.level = "debug";
log.catchErrors({
  showDialog: false,
  onError(error) {
    log.error("Application error:", error);
  },
});

// Initialize settings store
const store = new Store({
  name: "settings",
  defaults: {
    PRESENTATION: config.PRESENTATION,
    SECURITY: config.SECURITY,
  },
});

// Load saved settings
function loadSavedSettings() {
  try {
    // Load from store and merge with default config
    const savedSettings = store.store;

    if (savedSettings.PRESENTATION) {
      config.PRESENTATION = {
        ...config.PRESENTATION,
        ...savedSettings.PRESENTATION,
      };
    }

    if (savedSettings.SECURITY) {
      config.SECURITY = {
        ...config.SECURITY,
        ...savedSettings.SECURITY,
      };
    }

    log.info("Settings loaded from store");
  } catch (error) {
    log.error("Error loading settings:", error);
  }
}

// Load settings on startup
loadSavedSettings();

let mainWindow;
let settingsWindow;
let splashWindow;
let pinValidationWindow;

// Auto updater configuration
autoUpdater.logger = require("electron-log");
autoUpdater.logger.transports.file.level = "info";
autoUpdater.autoDownload = false;

// Handle auto updater events
function setupAutoUpdater() {
  // Check for updates when the app starts
  autoUpdater.checkForUpdates();

  // Set update check interval to once per hour
  setInterval(() => {
    autoUpdater.checkForUpdates();
  }, 60 * 60 * 1000);

  // When update available
  autoUpdater.on("update-available", (info) => {
    if (mainWindow) {
      const dialogOpts = {
        type: "info",
        buttons: ["Update Now", "Later"],
        title: "Application Update",
        message: `Version ${info.version} is available.`,
        detail: "A new version is available. Do you want to update now?",
      };

      dialog.showMessageBox(mainWindow, dialogOpts).then((returnValue) => {
        if (returnValue.response === 0) {
          // Start downloading the update
          autoUpdater.downloadUpdate();
          // Show download progress
          mainWindow.webContents.send("update-downloading");
        }
      });
    }
  });

  // When update not available
  autoUpdater.on("update-not-available", () => {
    console.log("No updates available");
  });

  // Handle download progress
  autoUpdater.on("download-progress", (progressObj) => {
    if (mainWindow) {
      mainWindow.webContents.send("update-download-progress", progressObj);
    }
  });

  // When update downloaded
  autoUpdater.on("update-downloaded", () => {
    if (mainWindow) {
      const dialogOpts = {
        type: "info",
        buttons: ["Restart", "Later"],
        title: "Application Update",
        message: "Update Downloaded",
        detail:
          "A new version has been downloaded. Restart the application to apply the updates.",
      };

      dialog.showMessageBox(mainWindow, dialogOpts).then((returnValue) => {
        if (returnValue.response === 0) {
          // Quit and install update
          autoUpdater.quitAndInstall();
        }
      });
    }
  });

  // Handle auto updater errors
  autoUpdater.on("error", (err) => {
    console.error("Auto updater error:", err);
    if (mainWindow) {
      mainWindow.webContents.send("update-error", err.message);
    }
  });
}

// Create splash window
function createSplashWindow() {
  try {
    log.info("Creating splash window");
    splashWindow = new BrowserWindow({
      width: 500,
      height: 300,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      icon: path.join(__dirname, "icons", "icon.png"),
    });

    // Determine asset paths based on environment (development vs production)
    let assetPath;
    if (app.isPackaged) {
      // In production, use the extraResources path
      assetPath = path.join(
        process.resourcesPath,
        "assets",
        "whatapp_command_center_splash.jpg"
      );
      log.info(`Using production splash image path: ${assetPath}`);
    } else {
      // In development, use the local path
      assetPath = path.join(
        __dirname,
        "assets",
        "whatapp_command_center_splash.jpg"
      );
      log.info(`Using development splash image path: ${assetPath}`);
    }

    // Check if the splash image exists
    let imageExists = false;
    try {
      fs.accessSync(assetPath, fs.constants.R_OK);
      imageExists = true;
      log.info("Splash image found successfully");
    } catch (err) {
      log.error(`Splash image not found at ${assetPath}:`, err);
    }

    // Create HTML content for splash screen
    const splashContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              margin: 0;
              padding: 0;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              background-color: ${imageExists ? "transparent" : "#202C33"};
              overflow: hidden;
              color: white;
              font-family: Arial, sans-serif;
            }
            img {
              max-width: 100%;
              max-height: 100%;
              object-fit: contain;
            }
            .text-center {
              text-align: center;
              padding: 20px;
            }
            h1 {
              font-size: 24px;
              margin-bottom: 10px;
            }
          </style>
        </head>
        <body>
          ${
            imageExists
              ? `<img src="${assetPath}" alt="WhatsApp Control Center">`
              : `<div class="text-center">
                 <h1>WhatsApp Control Center</h1>
                 <p>Loading application...</p>
               </div>`
          }
        </body>
      </html>
    `;

    const splashPath = path.join(app.getPath("temp"), "splash.html");
    log.info(`Writing splash content to ${splashPath}`);
    fs.writeFileSync(splashPath, splashContent);

    // Load the splash screen HTML
    splashWindow.loadFile(splashPath);

    // Close splash and open main window after 2.5 seconds
    setTimeout(() => {
      log.info("Splash timeout - creating main window");
      createWindow();
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        // Remove temp file
        try {
          fs.unlinkSync(splashPath);
        } catch (err) {
          log.warn("Failed to delete temp splash file:", err);
        }
      }
    }, 2500);
  } catch (error) {
    log.error("Error creating splash window:", error);
    // If splash fails, try to create main window directly
    createWindow();
  }
}

function createWindow() {
  try {
    log.info("Creating main window");

    // Determine resource paths based on environment (development vs production)
    const resourcePath = app.isPackaged ? process.resourcesPath : __dirname;
    const preloadPath = path.join(__dirname, "preload.js");
    const iconPath = app.isPackaged
      ? path.join(resourcePath, "icons", "icon.png")
      : path.join(__dirname, "icons", "icon.png");

    log.info(`Resource path: ${resourcePath}`);
    log.info(`Preload path: ${preloadPath}`);
    log.info(`Icon path: ${iconPath}`);

    // Create the browser window
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false, // For security reasons
        contextIsolation: true,
        preload: preloadPath,
      },
      icon: iconPath,
      show: false, // Don't show until ready
    });

    // Set Chrome user agent to bypass WhatsApp browser check
    const userAgent =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    mainWindow.webContents.setUserAgent(userAgent);

    // Load WhatsApp Web
    log.info("Loading WhatsApp Web URL");
    mainWindow.loadURL("https://web.whatsapp.com/");

    // Open DevTools in development or inspection mode
    if (config.AUTO_OPEN_DEVTOOLS) {
      mainWindow.webContents.openDevTools();
    }

    // Inject our custom CSS and JavaScript after the page loads
    mainWindow.webContents.on("did-finish-load", () => {
      log.info("Main window finished loading");
      try {
        // Determine paths for CSS and JS based on environment
        const cssPath = app.isPackaged
          ? path.join(__dirname, "styles.css")
          : path.join(__dirname, "styles.css");

        const jsPath = app.isPackaged
          ? path.join(__dirname, "renderer.js")
          : path.join(__dirname, "renderer.js");

        log.info(`Loading CSS from ${cssPath}`);
        let cssContent;
        try {
          cssContent = fs.readFileSync(cssPath, "utf8");
          mainWindow.webContents.insertCSS(cssContent);
          log.info("CSS injected successfully");
        } catch (cssErr) {
          log.error("Error loading CSS:", cssErr);
        }

        // Pass config to renderer script
        const configScript = `window.presentationAppConfig = ${JSON.stringify(
          config
        )};`;
        mainWindow.webContents
          .executeJavaScript(configScript)
          .then(() => log.info("Config injected successfully"))
          .catch((err) => log.error("Error injecting config:", err));

        // Inject JavaScript
        log.info(`Loading JS from ${jsPath}`);
        let jsContent;
        try {
          jsContent = fs.readFileSync(jsPath, "utf8");
          mainWindow.webContents
            .executeJavaScript(jsContent)
            .then(() => log.info("JavaScript injected successfully"))
            .catch((err) => log.error("Error executing JavaScript:", err));
        } catch (jsErr) {
          log.error("Error loading JavaScript file:", jsErr);
        }
      } catch (error) {
        log.error("Error injecting resources:", error);
      }
    });

    // Handle login issues - reload page if needed
    mainWindow.webContents.on(
      "did-fail-load",
      (event, errorCode, errorDescription) => {
        log.error(`Page failed to load: ${errorCode} - ${errorDescription}`);
        setTimeout(() => {
          log.info("Attempting to reload WhatsApp Web");
          mainWindow.loadURL("https://web.whatsapp.com/");
        }, 3000);
      }
    );

    // Create the application menu
    createApplicationMenu();

    // Initialize auto updater
    setupAutoUpdater();

    // Show window when ready
    mainWindow.once("ready-to-show", () => {
      log.info("Main window ready to show");

      // Only try to close splash window if it still exists
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }

      // Validate PIN if enabled before showing the main window
      if (config.SECURITY && config.SECURITY.PIN_ENABLED) {
        createPinValidationWindow(
          // Success callback - show the main window
          () => {
            mainWindow.show();
            mainWindow.focus();
          },
          // Cancel callback - quit the app if PIN validation is canceled
          () => {
            app.quit();
          }
        );
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    // Log errors from the renderer process
    mainWindow.webContents.on("crashed", () => {
      log.error("Renderer process crashed");
    });

    mainWindow.webContents.on(
      "console-message",
      (event, level, message, line, sourceId) => {
        // Fix the log level mapping
        const levels = ["debug", "info", "warning", "error"];
        const logLevel = levels[level] || "info";

        // Use the correct log function call
        if (logLevel === "debug") log.debug(`[Renderer] ${message}`);
        else if (logLevel === "info") log.info(`[Renderer] ${message}`);
        else if (logLevel === "warning") log.warn(`[Renderer] ${message}`);
        else if (logLevel === "error") log.error(`[Renderer] ${message}`);
        else log.info(`[Renderer] ${message}`);
      }
    );
  } catch (error) {
    log.error("Error creating main window:", error);
    dialog.showErrorBox(
      "Application Error",
      `Failed to start application: ${error.message}\n\nCheck the logs for more details.`
    );
  }
}

// Create application menu with only About and Settings
function createApplicationMenu() {
  const isMac = process.platform === "darwin";

  const template = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: "WhatsApp Control Center",
            submenu: [
              { role: "about" },
              { type: "separator" },
              {
                label: "Check for Updates",
                click: () => autoUpdater.checkForUpdates(),
              },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),

    // File menu for Windows/Linux
    ...(isMac
      ? []
      : [
          {
            label: "File",
            submenu: [
              {
                label: "Check for Updates",
                click: () => autoUpdater.checkForUpdates(),
              },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]),

    {
      label: "Options",
      submenu: [
        {
          label: "Fullscreen Mode",
          accelerator: "CmdOrCtrl+P",
          click: () => {
            // Send message to renderer to toggle presentation mode
            if (mainWindow) {
              mainWindow.webContents.send("toggle-presentation-mode");
            }
          },
        },
        {
          label: "Settings",
          click: () => openSettingsWindow(),
        },
        {
          label: "Check for Updates",
          click: () => autoUpdater.checkForUpdates(),
        },
        { type: "separator" },
        {
          label: "About",
          click: () => showAboutDialog(),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Open settings window
function openSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 600,
    height: 400,
    title: "Settings",
    parent: mainWindow,
    modal: false,
    icon: path.join(__dirname, "icons", "icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "settings-preload.js"),
    },
  });

  settingsWindow.loadFile("settings.html");

  // Pass config to settings window
  settingsWindow.webContents.on("did-finish-load", () => {
    settingsWindow.webContents.executeJavaScript(`
      window.settingsConfig = ${JSON.stringify(config)};
      if (typeof initializeSettings === 'function') {
        initializeSettings();
      }
    `);
  });

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

// Show about dialog
function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    title: "About WhatsApp Control Center",
    message: "WhatsApp Control Center",
    detail:
      "Version 0.1.4\nEnhanced WhatsApp Web interface with PIN protection for control rooms and productions",
    buttons: ["OK"],
  });
}

app.whenReady().then(() => {
  log.info("App ready, initializing application");
  try {
    // Create splash window
    createSplashWindow(); // Show splash screen instead of directly creating main window

    app.on("activate", function () {
      log.info("App activated");
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  } catch (error) {
    log.error("Error during app initialization:", error);
  }
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

// Handle IPC messages from renderer
ipcMain.on("toggle-full-screen", () => {
  if (mainWindow) {
    const isFullScreen = mainWindow.isFullScreen();

    // If we're exiting full-screen mode and PIN is enabled, validate PIN first
    if (isFullScreen && config.SECURITY && config.SECURITY.PIN_ENABLED) {
      createPinValidationWindow(
        // On success, exit full-screen
        () => {
          mainWindow.setFullScreen(false);
        }
      );
    } else {
      // Otherwise, toggle full-screen directly
      mainWindow.setFullScreen(!isFullScreen);
    }
  }
});

// Handle settings updates from settings window
ipcMain.on("update-settings", (event, updatedConfig) => {
  // Update the config
  Object.assign(config, updatedConfig);

  // Save to disk using electron-store
  try {
    // Save each section separately to handle partial updates
    if (updatedConfig.PRESENTATION) {
      store.set("PRESENTATION", updatedConfig.PRESENTATION);
    }

    if (updatedConfig.SECURITY) {
      store.set("SECURITY", updatedConfig.SECURITY);
    }

    log.info("Settings saved to store");
  } catch (error) {
    log.error("Error saving settings:", error);
  }

  // Notify main window of config update
  if (mainWindow) {
    mainWindow.webContents.send("config-updated", config);

    // Also update the global variable
    mainWindow.webContents.executeJavaScript(`
      window.presentationAppConfig = ${JSON.stringify(config)};
      if (typeof updateConfigFromMain === 'function') {
        updateConfigFromMain();
      }
    `);
  }
});

// Handle get-settings request
ipcMain.handle("get-settings", () => {
  return config;
});

// Close settings window
ipcMain.on("close-settings-window", () => {
  if (settingsWindow) {
    settingsWindow.close();
  }
});

// Handle IPC messages for updates
ipcMain.on("check-for-updates", () => {
  autoUpdater.checkForUpdates();
});

ipcMain.on("download-update", () => {
  autoUpdater.downloadUpdate();
});

ipcMain.on("quit-and-install", () => {
  autoUpdater.quitAndInstall();
});

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  log.error("Uncaught exception:", error);
  dialog.showErrorBox(
    "Application Error",
    `An unexpected error occurred: ${error.message}\n\nCheck the logs for more details.`
  );
});

// Function to create a PIN validation window
function createPinValidationWindow(onSuccess, onCancel = null) {
  // If PIN is not enabled, call success callback immediately
  if (!config.SECURITY || !config.SECURITY.PIN_ENABLED) {
    if (onSuccess) onSuccess();
    return;
  }

  // If PIN window already exists, just focus it
  if (pinValidationWindow) {
    pinValidationWindow.focus();
    return;
  }

  // Get the main window dimensions
  const mainWindowSize = mainWindow ? mainWindow.getSize() : [1200, 800];
  const mainWidth = mainWindowSize[0];
  const mainHeight = mainWindowSize[1];

  // Create PIN validation window
  pinValidationWindow = new BrowserWindow({
    width: mainWidth,
    height: mainHeight,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    frame: false, // Remove frame for better privacy
    transparent: false, // Ensure window is not transparent
    backgroundColor: "#000000", // Set background to black
    title: "PIN Verification",
    parent: mainWindow,
    modal: true,
    fullscreenable: false,
    skipTaskbar: true, // Don't show in taskbar for privacy
    icon: path.join(__dirname, "icons", "icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "pin-preload.js"),
    },
  });

  // Hide the menu bar
  pinValidationWindow.setMenuBarVisibility(false);

  // Add resize listener to main window to adjust PIN window size
  const resizeHandler = () => {
    if (
      pinValidationWindow &&
      !pinValidationWindow.isDestroyed() &&
      mainWindow
    ) {
      const [newWidth, newHeight] = mainWindow.getSize();
      pinValidationWindow.setSize(newWidth, newHeight);

      // Also update position to ensure it stays centered over main window
      const [x, y] = mainWindow.getPosition();
      pinValidationWindow.setPosition(x, y);
    }
  };

  if (mainWindow) {
    mainWindow.on("resize", resizeHandler);
    mainWindow.on("move", resizeHandler);
  }

  // Load PIN validation HTML
  pinValidationWindow.loadFile("pin-validation.html");

  // Pass PIN to window
  pinValidationWindow.webContents.on("did-finish-load", () => {
    pinValidationWindow.webContents.executeJavaScript(`
      window.pinConfig = ${JSON.stringify({
        PIN_CODE: config.SECURITY.PIN_CODE,
      })};
      if (typeof initializePinValidation === 'function') {
        initializePinValidation();
      }
    `);
  });

  // Store callbacks for use with IPC events
  pinValidationWindow.successCallback = onSuccess;
  pinValidationWindow.cancelCallback = onCancel;

  // Handle window closed
  pinValidationWindow.on("closed", () => {
    // Remove resize listeners when PIN window is closed
    if (mainWindow) {
      mainWindow.removeListener("resize", resizeHandler);
      mainWindow.removeListener("move", resizeHandler);
    }
    pinValidationWindow = null;
  });
}

// Add IPC handlers for PIN validation
ipcMain.on("validate-pin", (event, enteredPin) => {
  if (pinValidationWindow && enteredPin === config.SECURITY.PIN_CODE) {
    // PIN is correct
    const successCallback = pinValidationWindow.successCallback;
    pinValidationWindow.close();
    pinValidationWindow = null;

    if (successCallback) {
      successCallback();
    }
  } else {
    // PIN is incorrect
    event.reply("pin-validation-result", {
      success: false,
      message: "Incorrect PIN. Please try again.",
    });
  }
});

ipcMain.on("cancel-pin-validation", () => {
  if (pinValidationWindow) {
    const cancelCallback = pinValidationWindow.cancelCallback;

    // Store the reference before closing to avoid null check issues
    const storedCallback = cancelCallback;

    // Close the current window
    pinValidationWindow.close();
    pinValidationWindow = null;

    // If there's a cancel callback, call it (usually app.quit())
    if (storedCallback) {
      storedCallback();
    } else if (mainWindow) {
      // If no callback (e.g., from full-screen mode), recreate PIN window immediately
      // to ensure the PIN protection stays in place
      createPinValidationWindow(
        // Success callback - let the original action proceed
        () => {
          // PIN verified successfully
        },
        // Cancel callback - prevent window access
        () => {
          app.quit();
        }
      );
    }
  }
});

// Add IPC handler for forgot PIN functionality
ipcMain.on("forgot-pin", () => {
  if (pinValidationWindow) {
    // 1. Clear the existing PIN
    config.SECURITY.PIN_CODE = "";
    config.SECURITY.PIN_ENABLED = false;

    // Save the updated configuration
    store.set("SECURITY", config.SECURITY);

    log.info("PIN reset initiated - clearing data");

    // 2. Clear all WhatsApp data and cache
    session.defaultSession
      .clearStorageData({
        storages: [
          "appcache",
          "cookies",
          "filesystem",
          "indexdb",
          "localstorage",
          "shadercache",
          "websql",
          "serviceworkers",
          "cachestorage",
        ],
      })
      .then(() => {
        log.info("Cache and data cleared successfully");

        if (mainWindow && !mainWindow.isDestroyed()) {
          // Set up a one-time load finished listener
          const loadFinishedListener = () => {
            log.info("WhatsApp reload completed");

            // Reinject CSS and JavaScript just like in the initial load
            try {
              // Determine paths for CSS and JS based on environment
              const cssPath = app.isPackaged
                ? path.join(__dirname, "styles.css")
                : path.join(__dirname, "styles.css");

              const jsPath = app.isPackaged
                ? path.join(__dirname, "renderer.js")
                : path.join(__dirname, "renderer.js");

              log.info(`Reinjecting CSS from ${cssPath}`);
              let cssContent;
              try {
                cssContent = fs.readFileSync(cssPath, "utf8");
                mainWindow.webContents.insertCSS(cssContent);
                log.info("CSS reinjected successfully");
              } catch (cssErr) {
                log.error("Error loading CSS:", cssErr);
              }

              // Pass config to renderer script
              const configScript = `window.presentationAppConfig = ${JSON.stringify(
                config
              )};`;
              mainWindow.webContents
                .executeJavaScript(configScript)
                .then(() => log.info("Config reinjected successfully"))
                .catch((err) => log.error("Error injecting config:", err));

              // Inject JavaScript
              log.info(`Reinjecting JS from ${jsPath}`);
              let jsContent;
              try {
                jsContent = fs.readFileSync(jsPath, "utf8");
                mainWindow.webContents
                  .executeJavaScript(jsContent)
                  .then(() => log.info("JavaScript reinjected successfully"))
                  .catch((err) =>
                    log.error("Error executing JavaScript:", err)
                  );
              } catch (jsErr) {
                log.error("Error loading JavaScript file:", jsErr);
              }
            } catch (error) {
              log.error("Error reinjecting resources:", error);
            }

            // Small delay to ensure everything is rendered properly
            setTimeout(() => {
              // Only now close the PIN validation window
              if (pinValidationWindow && !pinValidationWindow.isDestroyed()) {
                pinValidationWindow.close();
                pinValidationWindow = null;
              }
            }, 500);
          };

          // Listen for the page to finish loading
          mainWindow.webContents.once("did-finish-load", loadFinishedListener);

          // Start loading WhatsApp
          log.info("Reloading WhatsApp web");
          mainWindow.loadURL("https://web.whatsapp.com/");
        } else {
          // No main window, close PIN window
          if (pinValidationWindow && !pinValidationWindow.isDestroyed()) {
            pinValidationWindow.close();
            pinValidationWindow = null;
          }
        }
      })
      .catch((error) => {
        log.error("Error clearing cache:", error);

        // Set up load finished listener even in case of error
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.once("did-finish-load", () => {
            // Reinject CSS and JavaScript here too
            try {
              const cssPath = app.isPackaged
                ? path.join(__dirname, "styles.css")
                : path.join(__dirname, "styles.css");

              const jsPath = app.isPackaged
                ? path.join(__dirname, "renderer.js")
                : path.join(__dirname, "renderer.js");

              let cssContent;
              try {
                cssContent = fs.readFileSync(cssPath, "utf8");
                mainWindow.webContents.insertCSS(cssContent);
              } catch (cssErr) {
                log.error("Error loading CSS in error handler:", cssErr);
              }

              const configScript = `window.presentationAppConfig = ${JSON.stringify(
                config
              )};`;
              mainWindow.webContents.executeJavaScript(configScript);

              let jsContent;
              try {
                jsContent = fs.readFileSync(jsPath, "utf8");
                mainWindow.webContents.executeJavaScript(jsContent);
              } catch (jsErr) {
                log.error("Error loading JavaScript in error handler:", jsErr);
              }
            } catch (error) {
              log.error("Error reinjecting resources in error handler:", error);
            }

            setTimeout(() => {
              if (pinValidationWindow && !pinValidationWindow.isDestroyed()) {
                pinValidationWindow.close();
                pinValidationWindow = null;
              }
            }, 500);
          });

          mainWindow.loadURL("https://web.whatsapp.com/");
        } else {
          if (pinValidationWindow && !pinValidationWindow.isDestroyed()) {
            pinValidationWindow.close();
            pinValidationWindow = null;
          }
        }
      });
  }
});
