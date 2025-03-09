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

// Set up enhanced logging
const log = require("electron-log");
log.transports.file.level = "debug";
log.catchErrors({
  showDialog: false,
  onError(error) {
    log.error("Application error:", error);
  },
});

let mainWindow;
let settingsWindow;
let splashWindow;

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
      if (splashWindow) {
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
      mainWindow.show();
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

    {
      label: "Options",
      submenu: [
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
      "Version 1.0.0\nEnhanced WhatsApp Web interface for control rooms and productions",
    buttons: ["OK"],
  });
}

app.whenReady().then(() => {
  log.info("App ready, initializing application");
  try {
    createSplashWindow(); // Show splash screen instead of directly creating main window

    app.on("activate", function () {
      log.info("App activated");
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  } catch (error) {
    log.error("Error in app initialization:", error);
    dialog.showErrorBox(
      "Application Error",
      `Failed to initialize application: ${error.message}\n\nCheck the logs for more details.`
    );
  }
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

// Handle IPC messages from renderer
ipcMain.on("toggle-fullscreen", () => {
  if (mainWindow) {
    const isFullScreen = mainWindow.isFullScreen();
    mainWindow.setFullScreen(!isFullScreen);
  }
});

// Handle settings updates from settings window
ipcMain.on("update-settings", (event, updatedConfig) => {
  // Update the config
  Object.assign(config, updatedConfig);

  // Save to disk (optional implementation)

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
