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

let mainWindow;
let settingsWindow;
let splashWindow;

// Create splash window
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 500,
    height: 300,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    icon: path.join(__dirname, "icons", "icon.png"),
  });

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
            background-color: transparent;
            overflow: hidden;
          }
          img {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
          }
        </style>
      </head>
      <body>
        <img src="${path.join(
          __dirname,
          "assets",
          "whatapp_command_center_splash.jpg"
        )}" alt="WhatsApp Control Center">
      </body>
    </html>
  `;

  // Write splash content to a temporary file
  const splashPath = path.join(__dirname, "splash.html");
  fs.writeFileSync(splashPath, splashContent);

  // Load the splash screen HTML
  splashWindow.loadFile(splashPath);

  // Close splash and open main window after 2.5 seconds
  setTimeout(() => {
    createWindow();
    splashWindow.close();
    // Remove temp file
    fs.unlinkSync(splashPath);
  }, 2500);
}

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false, // For security reasons
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    icon: path.join(__dirname, "icons", "icon.png"),
    show: false, // Don't show until ready
  });

  // Set Chrome user agent to bypass WhatsApp browser check
  const userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  mainWindow.webContents.setUserAgent(userAgent);

  // Load WhatsApp Web
  mainWindow.loadURL("https://web.whatsapp.com/");

  // Open DevTools in development or inspection mode
  if (config.AUTO_OPEN_DEVTOOLS) {
    mainWindow.webContents.openDevTools();
  }

  // Inject our custom CSS and JavaScript after the page loads
  mainWindow.webContents.on("did-finish-load", () => {
    // Inject CSS
    const cssContent = fs.readFileSync(
      path.join(__dirname, "styles.css"),
      "utf8"
    );
    mainWindow.webContents.insertCSS(cssContent);

    // Pass config to renderer script
    const configScript = `window.presentationAppConfig = ${JSON.stringify(
      config
    )};`;
    mainWindow.webContents.executeJavaScript(configScript);

    // Inject JavaScript
    const jsContent = fs.readFileSync(
      path.join(__dirname, "renderer.js"),
      "utf8"
    );
    mainWindow.webContents.executeJavaScript(jsContent);
  });

  // Handle login issues - reload page if needed
  mainWindow.webContents.on("did-fail-load", () => {
    setTimeout(() => {
      mainWindow.loadURL("https://web.whatsapp.com/");
    }, 3000);
  });

  // Create the application menu
  createApplicationMenu();

  // Show window when ready
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
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
  createSplashWindow(); // Show splash screen instead of directly creating main window

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
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
