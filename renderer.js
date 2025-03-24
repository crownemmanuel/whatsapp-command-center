// WhatsApp Web Presentation Mode
(function () {
  // Load configuration from global variable set by main process
  const config = window.presentationAppConfig || {
    INSPECTION_MODE: false,
    PRESENTATION: {
      MAX_MESSAGES: 5,
      ALERT_EMOJI: "🚨",
      POPUP_ALERT_MESSAGES: false,
      MESSAGE_FONT_SIZE: 36,
    },
  };

  // Configuration
  const PRESENTATION_MODE_BUTTON_ID = "whatsapp-presentation-mode-button";
  const INSPECTION_MODE_BUTTON_ID = "whatsapp-inspection-mode-button";
  const FULL_SCREEN_CONTAINER_ID = "whatsapp-presentation-container";
  const ALERT_EMOJI = config.PRESENTATION.ALERT_EMOJI; // The emoji that triggers the alert mode

  // Update notification elements
  const UPDATE_NOTIFICATION_ID = "whatsapp-update-notification";
  const UPDATE_PROGRESS_BAR_ID = "whatsapp-update-progress-bar";

  // Message selectors based on provided HTML structure
  const MESSAGE_SELECTORS = {
    // Main message container - Updated from DOM sample
    CONTAINER:
      '._amk4._amkd._amk5, ._amk4, ._amkd, ._amk5, [data-testid="msg-container"]',

    // Message text content - Updated from DOM sample
    TEXT: '._ao3e.selectable-text.copyable-text, span._ao3e, [data-testid="balloon-text-content"]',

    // Sender info (for group chats)
    SENDER: '[data-pre-plain-text], [data-testid="msg-meta"] span',

    // Timestamp - Updated from DOM sample
    TIMESTAMP: '.x1c4vz4f.x2lah0s, [data-testid="msg-meta"]',

    // Message reactions - Updated from DOM sample
    REACTION:
      'button[aria-label^="reaction"], [data-testid="msg-reaction"], .x78zum5.x1n2onr6.xbfrwjf.x8k05lb button.xd7y6wv',

    // Emoji image - Added from DOM sample
    EMOJI: ".x1k0y4fr.xl79k7v.b80.emoji.apple._ao3e, img.emoji",
  };

  // State
  let isInPresentationMode = false;
  let isInspectionModeActive = false;
  let isFlashing = false;
  let flashingInterval = null;
  let lastProcessedMessageId = null;
  let mainContainer = null;
  let currentChat = null;
  let lastProcessedMessages = new Set(); // Track already processed messages

  // Function to handle the 'S' key press to stop flashing
  function handleKeyPress(e) {
    if (
      isInPresentationMode &&
      isFlashing &&
      (e.key === "s" || e.key === "S")
    ) {
      stopFlashing();
    }
  }

  // Function to update configuration from main process
  function updateConfigFromMain() {
    if (window.presentationAppConfig) {
      // Update local config object with values from main process
      Object.assign(config, window.presentationAppConfig);

      // Update UI elements that use these values
      updateUIWithNewConfig();

      // Update presentation if it's active
      if (isInPresentationMode) {
        updatePresentationMessages();
      }

      window.electronAPI.logInfo("Configuration updated from settings");
    }
  }

  // Update UI elements with new config values
  function updateUIWithNewConfig() {
    // Update message font size in CSS
    const styleElement = document.getElementById("dynamic-presentation-styles");
    if (!styleElement) {
      // Create style element if it doesn't exist
      const newStyleElement = document.createElement("style");
      newStyleElement.id = "dynamic-presentation-styles";
      document.head.appendChild(newStyleElement);
    }

    // Update or create styles based on config
    const dynamicStyles = `
      #presentation-messages > div {
        font-size: ${config.PRESENTATION.MESSAGE_FONT_SIZE}px !important;
        line-height: 1.4 !important;
      }
    `;

    const styleEl = document.getElementById("dynamic-presentation-styles");
    if (styleEl) {
      styleEl.textContent = dynamicStyles;
    }
  }

  // Setup update notification
  function setupUpdateNotification() {
    // Create update notification container if it doesn't exist
    let updateNotification = document.getElementById(UPDATE_NOTIFICATION_ID);
    if (!updateNotification) {
      // Create the notification element
      updateNotification = document.createElement("div");
      updateNotification.id = UPDATE_NOTIFICATION_ID;
      updateNotification.style.display = "none";
      updateNotification.style.position = "fixed";
      updateNotification.style.bottom = "20px";
      updateNotification.style.right = "20px";
      updateNotification.style.backgroundColor = "#2962FF";
      updateNotification.style.color = "white";
      updateNotification.style.padding = "15px";
      updateNotification.style.borderRadius = "5px";
      updateNotification.style.boxShadow = "0 2px 10px rgba(0, 0, 0, 0.2)";
      updateNotification.style.zIndex = "10000";
      updateNotification.style.maxWidth = "300px";
      updateNotification.style.fontFamily =
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

      // Create the notification content
      const notificationTitle = document.createElement("div");
      notificationTitle.style.fontWeight = "bold";
      notificationTitle.style.marginBottom = "10px";
      notificationTitle.textContent = "Update Available";
      updateNotification.appendChild(notificationTitle);

      const notificationMessage = document.createElement("div");
      notificationMessage.id = "update-message";
      notificationMessage.style.marginBottom = "15px";
      notificationMessage.textContent = "A new version is available.";
      updateNotification.appendChild(notificationMessage);

      // Create progress bar for download progress
      const progressContainer = document.createElement("div");
      progressContainer.style.width = "100%";
      progressContainer.style.height = "8px";
      progressContainer.style.backgroundColor = "rgba(255, 255, 255, 0.3)";
      progressContainer.style.borderRadius = "4px";
      progressContainer.style.overflow = "hidden";
      progressContainer.style.marginBottom = "15px";
      progressContainer.style.display = "none";
      updateNotification.appendChild(progressContainer);

      const progressBar = document.createElement("div");
      progressBar.id = UPDATE_PROGRESS_BAR_ID;
      progressBar.style.width = "0%";
      progressBar.style.height = "100%";
      progressBar.style.backgroundColor = "white";
      progressBar.style.transition = "width 0.3s";
      progressContainer.appendChild(progressBar);

      // Create buttons container
      const buttonsContainer = document.createElement("div");
      buttonsContainer.style.display = "flex";
      buttonsContainer.style.gap = "10px";
      updateNotification.appendChild(buttonsContainer);

      // Download button
      const downloadButton = document.createElement("button");
      downloadButton.textContent = "Download Update";
      downloadButton.style.backgroundColor = "white";
      downloadButton.style.color = "#2962FF";
      downloadButton.style.border = "none";
      downloadButton.style.padding = "8px 12px";
      downloadButton.style.borderRadius = "4px";
      downloadButton.style.cursor = "pointer";
      downloadButton.style.fontWeight = "bold";
      downloadButton.style.flex = "1";
      downloadButton.onclick = () => {
        window.electronAPI.downloadUpdate();

        // Show progress container
        progressContainer.style.display = "block";

        // Update buttons
        downloadButton.style.display = "none";
        laterButton.style.display = "none";

        // Update message
        notificationMessage.textContent = "Downloading update...";
      };
      buttonsContainer.appendChild(downloadButton);

      // Later button
      const laterButton = document.createElement("button");
      laterButton.textContent = "Later";
      laterButton.style.backgroundColor = "transparent";
      laterButton.style.color = "white";
      laterButton.style.border = "1px solid white";
      laterButton.style.padding = "8px 12px";
      laterButton.style.borderRadius = "4px";
      laterButton.style.cursor = "pointer";
      laterButton.style.flex = "1";
      laterButton.onclick = () => {
        updateNotification.style.display = "none";
      };
      buttonsContainer.appendChild(laterButton);

      // Restart button (for after download complete)
      const restartButton = document.createElement("button");
      restartButton.textContent = "Restart Now";
      restartButton.style.backgroundColor = "white";
      restartButton.style.color = "#2962FF";
      restartButton.style.border = "none";
      restartButton.style.padding = "8px 12px";
      restartButton.style.borderRadius = "4px";
      restartButton.style.cursor = "pointer";
      restartButton.style.fontWeight = "bold";
      restartButton.style.flex = "1";
      restartButton.style.display = "none";
      restartButton.onclick = () => {
        window.electronAPI.quitAndInstall();
      };
      buttonsContainer.appendChild(restartButton);

      // Close button
      const closeButton = document.createElement("button");
      closeButton.textContent = "×";
      closeButton.style.position = "absolute";
      closeButton.style.top = "5px";
      closeButton.style.right = "5px";
      closeButton.style.backgroundColor = "transparent";
      closeButton.style.color = "white";
      closeButton.style.border = "none";
      closeButton.style.fontSize = "18px";
      closeButton.style.cursor = "pointer";
      closeButton.style.width = "24px";
      closeButton.style.height = "24px";
      closeButton.style.display = "flex";
      closeButton.style.alignItems = "center";
      closeButton.style.justifyContent = "center";
      closeButton.onclick = () => {
        updateNotification.style.display = "none";
      };
      updateNotification.appendChild(closeButton);

      // Add to document
      document.body.appendChild(updateNotification);

      // Setup event listeners for update events
      if (window.electronAPI) {
        // Update downloading started
        window.electronAPI.onUpdateDownloading(() => {
          updateNotification.style.display = "block";
          progressContainer.style.display = "block";
          downloadButton.style.display = "none";
          laterButton.style.display = "none";
          notificationMessage.textContent = "Downloading update...";
        });

        // Update download progress
        window.electronAPI.onUpdateProgress((progress) => {
          const progressPercent = Math.round(progress.percent) || 0;
          progressBar.style.width = `${progressPercent}%`;
          notificationMessage.textContent = `Downloading: ${progressPercent}%`;
        });

        // Update download complete
        window.electronAPI.onUpdateDownloaded(() => {
          notificationTitle.textContent = "Update Ready";
          notificationMessage.textContent =
            "Update has been downloaded. Restart to apply.";
          progressContainer.style.display = "none";
          restartButton.style.display = "block";
          laterButton.style.display = "block";
          laterButton.textContent = "Later";
        });

        // Update error
        window.electronAPI.onUpdateError((error) => {
          notificationTitle.textContent = "Update Error";
          notificationMessage.textContent = `Error: ${error}`;
          progressContainer.style.display = "none";
          downloadButton.style.display = "none";
          laterButton.textContent = "Close";
          laterButton.style.display = "block";
        });
      }
    }
  }

  // Initialize when the DOM is fully loaded
  function initialize() {
    console.log("WhatsApp Presentation Mode: Initializing...");

    // Setup update notification
    setupUpdateNotification();

    // Add the custom header at the top of the page
    addCustomHeader();

    // Create mutation observer to detect when we enter a chat
    const observer = new MutationObserver(detectChatView);
    observer.observe(document.body, { childList: true, subtree: true });

    // Check if we're already in a chat
    setTimeout(detectChatView, 3000);

    // Initialize inspection mode if enabled
    if (config.INSPECTION_MODE) {
      window.electronAPI.logInfo("Inspection mode is enabled in config");
      initializeInspectionMode();
    }

    // Initialize dynamic styles based on config
    updateUIWithNewConfig();
  }

  // Add a custom header at the top of the WhatsApp page
  function addCustomHeader() {
    // Check if header already exists
    if (document.getElementById("whatsapp-command-header")) {
      return;
    }

    // Create the header container
    const header = document.createElement("div");
    header.id = "whatsapp-command-header";
    header.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 40px;
      background-color: #1a1a1a;
      color: white;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 20px;
      z-index: 1000;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    `;

    // Create the left side with app name
    const appName = document.createElement("div");
    appName.textContent = "WhatsApp Command Center";
    appName.style.cssText = `
      font-weight: bold;
      font-size: 16px;
    `;

    // Create the right side with controls
    const controls = document.createElement("div");
    controls.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      padding-right: 20px;
    `;

    // Create present button
    const presentButton = document.createElement("button");
    presentButton.id = PRESENTATION_MODE_BUTTON_ID;
    presentButton.innerHTML = "📺 Fullscreen Mode";
    presentButton.title = "Enter Presentation Mode";
    presentButton.style.cssText = `
      background-color: #008b6f;
      color: white;
      border: none;
      border-radius: 3px;
      padding: 6px 12px;
      cursor: pointer;
      font-size: 14px;
    `;
    presentButton.addEventListener("click", togglePresentationMode);
    controls.appendChild(presentButton);

    // Add inspection button if inspection mode is enabled
    if (config.INSPECTION_MODE) {
      const inspectionButton = document.createElement("button");
      inspectionButton.id = INSPECTION_MODE_BUTTON_ID;
      inspectionButton.innerHTML = "🔍 Inspect";
      inspectionButton.title = "Toggle Inspection Mode";
      inspectionButton.style.cssText = `
        background-color: #f44336;
        color: white;
        border: none;
        border-radius: 3px;
        padding: 6px 12px;
        cursor: pointer;
        font-size: 14px;
      `;
      inspectionButton.addEventListener("click", toggleInspectionMode);
      controls.appendChild(inspectionButton);
    }

    // Add elements to header
    header.appendChild(appName);
    header.appendChild(controls);

    // Add header to the document
    document.body.insertBefore(header, document.body.firstChild);

    // Push the WhatsApp content down to make room for the header
    const pushContent = () => {
      const whatsappContent = document.querySelector(
        '#app, .app, [role="application"]'
      );
      if (whatsappContent) {
        whatsappContent.style.marginTop = "40px";
      } else {
        setTimeout(pushContent, 500);
      }
    };

    pushContent();
  }

  // Initialize inspection mode
  function initializeInspectionMode() {
    // Add keyboard shortcut to toggle inspection mode (Ctrl+Shift+I)
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === "I") {
        toggleInspectionMode();
      }
    });
  }

  // Toggle inspection mode
  function toggleInspectionMode() {
    isInspectionModeActive = !isInspectionModeActive;

    if (isInspectionModeActive) {
      window.electronAPI.logInfo(
        "Inspection mode activated - click on elements to inspect"
      );
      document.body.style.cursor = "crosshair";
      document.addEventListener("click", inspectElement, true);

      // Add visual indicator for inspection mode
      const indicator = document.createElement("div");
      indicator.id = "inspection-mode-indicator";
      indicator.textContent = "INSPECTION MODE";
      indicator.style.cssText = `
        position: fixed;
        top: 0;
        right: 0;
        background-color: red;
        color: white;
        padding: 5px 10px;
        z-index: 10000;
        font-weight: bold;
      `;
      document.body.appendChild(indicator);
    } else {
      window.electronAPI.logInfo("Inspection mode deactivated");
      document.body.style.cursor = "";
      document.removeEventListener("click", inspectElement, true);

      // Remove the indicator
      const indicator = document.getElementById("inspection-mode-indicator");
      if (indicator) indicator.remove();
    }
  }

  // Inspect the clicked element
  function inspectElement(e) {
    e.preventDefault();
    e.stopPropagation();

    const element = e.target;

    // Collect data about the element
    const elementInfo = {
      tagName: element.tagName,
      id: element.id,
      classList: Array.from(element.classList),
      attributes: {},
      dataAttributes: {},
      textContent:
        element.textContent.substring(0, 100) +
        (element.textContent.length > 100 ? "..." : ""),
      xpath: getXPath(element),
      cssSelector: getCssSelector(element),
      rect: element.getBoundingClientRect().toJSON(),
    };

    // Get all attributes
    for (const attr of element.attributes) {
      elementInfo.attributes[attr.name] = attr.value;

      // Collect data attributes separately
      if (attr.name.startsWith("data-")) {
        elementInfo.dataAttributes[attr.name] = attr.value;
      }
    }

    // Log element info to console
    window.electronAPI.logElement(elementInfo);

    // Highlight the element temporarily
    const originalOutline = element.style.outline;
    element.style.outline = "2px solid red";
    setTimeout(() => {
      element.style.outline = originalOutline;
    }, 2000);

    return false;
  }

  // Get XPath for an element
  function getXPath(element) {
    if (element.id !== "") {
      return `//*[@id="${element.id}"]`;
    }

    if (element === document.body) {
      return "/html/body";
    }

    let ix = 0;
    const siblings = element.parentNode.childNodes;

    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];

      if (sibling === element) {
        return (
          getXPath(element.parentNode) +
          "/" +
          element.tagName.toLowerCase() +
          "[" +
          (ix + 1) +
          "]"
        );
      }

      if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
        ix++;
      }
    }
  }

  // Get a CSS selector for an element
  function getCssSelector(element) {
    if (element.id) {
      return "#" + element.id;
    }

    let selector = element.tagName.toLowerCase();

    if (element.className) {
      selector += "." + Array.from(element.classList).join(".");
    }

    return selector;
  }

  // Detect when we are in a chat view
  function detectChatView() {
    // Look for the main chat container
    const chatContainer =
      document.querySelector('[data-testid="conversation-panel-wrapper"]') ||
      document.querySelector(".two") ||
      document.querySelector('[data-testid="conversation-panel"]');

    if (
      chatContainer &&
      !document.getElementById(PRESENTATION_MODE_BUTTON_ID)
    ) {
      console.log("WhatsApp Presentation Mode: Chat detected, adding button");
      addPresentationButton(chatContainer);
      mainContainer = chatContainer;
    }
  }

  // Add the presentation mode button to the header
  function addPresentationButton(chatContainer) {
    // Find the header where we'll place our button
    const header =
      chatContainer.querySelector("header") ||
      chatContainer.querySelector('[data-testid="conversation-header"]');

    if (!header) return;

    // The buttons are now in the custom header, so we only need to
    // store the reference to the main container and start monitoring
    mainContainer = chatContainer;

    // Start monitoring messages
    startMessageMonitoring();
  }

  // Toggle presentation mode on/off
  function togglePresentationMode() {
    // Log the toggle action
    if (window.electronAPI) {
      window.electronAPI.logInfo(
        `Toggling presentation mode. Current state: ${
          isInPresentationMode ? "active" : "inactive"
        }`
      );
    }

    if (isInPresentationMode) {
      exitPresentationMode();
    } else {
      // Check if mainContainer is set, and if not, try to find it
      if (!mainContainer) {
        // Look for the chat container before trying to enter presentation mode
        const chatContainer =
          document.querySelector(
            '[data-testid="conversation-panel-wrapper"]'
          ) ||
          document.querySelector(".two") ||
          document.querySelector('[data-testid="conversation-panel"]');

        if (chatContainer) {
          if (window.electronAPI) {
            window.electronAPI.logInfo(
              "Chat container found, setting mainContainer"
            );
          }
          mainContainer = chatContainer;
          // Start monitoring messages if it wasn't already started
          startMessageMonitoring();
        } else {
          if (window.electronAPI) {
            window.electronAPI.logInfo(
              "No chat container found, can't enter presentation mode"
            );
          }
          alert("Please open a chat first before entering presentation mode.");
          return;
        }
      }

      enterPresentationMode();
    }
  }

  // Enter presentation mode
  function enterPresentationMode() {
    if (!mainContainer) {
      if (window.electronAPI) {
        window.electronAPI.logInfo(
          "Cannot enter presentation mode: mainContainer not found"
        );
      }
      return;
    }

    // Log entering presentation mode
    if (window.electronAPI) {
      window.electronAPI.logInfo("Entering presentation mode");
    }

    // Get chat title
    const chatTitle =
      document.querySelector(
        '[data-testid="conversation-info-header-chat-title"]'
      )?.textContent || "WhatsApp Chat";

    // Create full-screen container
    const container = document.createElement("div");
    container.id = FULL_SCREEN_CONTAINER_ID;
    container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background-color: #1f2c34;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      color: white;
      overflow: hidden;
    `;

    // Add header with title and exit button
    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background-color: #1a1a1a;">
        <h1 style="margin: 0; font-size: 24px;">${chatTitle} - Presentation Mode</h1>
        <div>
          <button id="stop-flashing-btn" style="background-color: #d33; color: white; border: none; border-radius: 3px; padding: 6px 12px; margin-right: 10px; display: none; cursor: pointer;">Stop Flashing (S)</button>
          <button id="exit-presentation-btn" style="background-color: #333; color: white; border: none; border-radius: 3px; padding: 6px 12px; cursor: pointer;">Exit</button>
        </div>
      </div>
      <div id="presentation-messages" style="flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; justify-content: flex-end;">
        <div style="text-align: center; opacity: 0.5; margin-bottom: 20px;">Waiting for new messages...</div>
      </div>
    `;

    document.body.appendChild(container);

    // Add event listeners for exit and stop flashing buttons
    document
      .getElementById("exit-presentation-btn")
      .addEventListener("click", exitPresentationMode);
    document
      .getElementById("stop-flashing-btn")
      .addEventListener("click", stopFlashing);

    // Add keyboard event listener for 'S' key to stop flashing
    document.addEventListener("keydown", handleKeyPress);

    // Enter fullscreen if possible
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen();
    }

    // Update button text in our custom header
    const presentButton = document.getElementById(PRESENTATION_MODE_BUTTON_ID);
    if (presentButton) {
      presentButton.innerHTML = "📺 Exit Present Mode";
      presentButton.title = "Exit Presentation Mode";
    }

    isInPresentationMode = true;
    currentChat = chatTitle;

    // Update with existing messages
    updatePresentationMessages();
  }

  // Exit presentation mode
  function exitPresentationMode() {
    // Check if PIN protection is enabled
    if (config.SECURITY && config.SECURITY.PIN_ENABLED) {
      // Create PIN verification overlay
      createPinVerificationOverlay(() => {
        // On successful PIN verification
        actuallyExitPresentationMode();
      });
    } else {
      // If PIN is not enabled, exit directly
      actuallyExitPresentationMode();
    }
  }

  // Actual exit presentation mode implementation (after PIN verification if needed)
  function actuallyExitPresentationMode() {
    // Log the state transition for debugging
    if (window.electronAPI) {
      window.electronAPI.logInfo("Exiting presentation mode");
    } else {
      console.log("Exiting presentation mode");
    }

    const container = document.getElementById(FULL_SCREEN_CONTAINER_ID);
    if (container) {
      container.remove();
    }

    // Remove keydown event listener
    document.removeEventListener("keydown", handleKeyPress);

    // Exit fullscreen if we're in it
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen();
    }

    // Update button text - now we look for the button in our custom header
    const presentButton = document.getElementById(PRESENTATION_MODE_BUTTON_ID);
    if (presentButton) {
      presentButton.innerHTML = "📺 Fullscreen Mode";
      presentButton.title = "Enter Presentation Mode";

      // Log button text change for debugging
      if (window.electronAPI) {
        window.electronAPI.logInfo(
          "Reset button text to: " + presentButton.innerHTML
        );
      } else {
        console.log("Reset button text to: " + presentButton.innerHTML);
      }
    } else {
      // Log if button is not found
      if (window.electronAPI) {
        window.electronAPI.logInfo(
          "Present button not found when exiting presentation mode"
        );
      } else {
        console.log("Present button not found when exiting presentation mode");
      }
    }

    // Stop any flashing
    stopFlashing();

    isInPresentationMode = false;
    currentChat = null;
  }

  // Create PIN verification overlay with full black background for privacy
  function createPinVerificationOverlay(onSuccess) {
    // Create overlay container
    const overlay = document.createElement("div");
    overlay.id = "pin-verification-overlay";
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background-color: #000;
      z-index: 20000;
      display: flex;
      justify-content: center;
      align-items: center;
      flex-direction: column;
    `;

    // Create PIN form
    const pinForm = document.createElement("div");
    pinForm.style.cssText = `
      background-color: #1f2c34;
      padding: 25px;
      border-radius: 8px;
      width: 300px;
      text-align: center;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
    `;

    pinForm.innerHTML = `
      <h2 style="color: #00a884; margin-bottom: 20px; margin-top: 0;">Enter PIN</h2>
      <div style="margin-bottom: 15px;">
        <input type="password" id="pin-input-field" maxlength="6" pattern="[0-9]*" 
          inputmode="numeric" placeholder="******" style="width: 100%; padding: 10px; 
          border: 1px solid #ddd; border-radius: 4px; font-size: 16px; 
          text-align: center; letter-spacing: 4px; background-color: #2a3942; color: white;">
      </div>
      <div id="pin-error-message" style="color: #e53935; font-size: 14px; 
        margin-top: 10px; min-height: 20px;"></div>
      <div style="display: flex; justify-content: space-between; margin-top: 20px;">
        <button id="pin-cancel-btn" style="padding: 8px 16px; border-radius: 4px; 
          border: none; cursor: pointer; font-size: 14px; background-color: #f5f5f5; 
          color: #333; min-width: 100px;">Cancel</button>
        <button id="pin-submit-btn" style="padding: 8px 16px; border-radius: 4px; 
          border: none; cursor: pointer; font-size: 14px; background-color: #00a884; 
          color: white; min-width: 100px;">Submit</button>
      </div>
    `;

    overlay.appendChild(pinForm);
    document.body.appendChild(overlay);

    // Set focus on PIN input
    setTimeout(() => {
      const pinInput = document.getElementById("pin-input-field");
      if (pinInput) {
        pinInput.focus();
      }
    }, 100);

    // Handle form submission
    document.getElementById("pin-submit-btn").addEventListener("click", () => {
      verifyPin(onSuccess);
    });

    // Handle cancel button
    document.getElementById("pin-cancel-btn").addEventListener("click", () => {
      removeOverlay();
    });

    // Handle enter key
    document
      .getElementById("pin-input-field")
      .addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          verifyPin(onSuccess);
        }
      });
  }

  // Verify entered PIN against stored PIN
  function verifyPin(onSuccess) {
    const pinInput = document.getElementById("pin-input-field");
    const enteredPin = pinInput.value.trim();
    const correctPin = config.SECURITY.PIN_CODE;

    if (enteredPin === correctPin) {
      // PIN is correct
      removeOverlay();
      if (onSuccess) {
        onSuccess();
      }
    } else {
      // PIN is incorrect
      const errorElement = document.getElementById("pin-error-message");
      errorElement.textContent = "Incorrect PIN. Please try again.";

      // Clear error after 3 seconds
      setTimeout(() => {
        if (errorElement) {
          errorElement.textContent = "";
        }
      }, 3000);

      // Clear input and focus
      pinInput.value = "";
      pinInput.focus();
    }
  }

  // Remove PIN verification overlay
  function removeOverlay() {
    const overlay = document.getElementById("pin-verification-overlay");
    if (overlay) {
      overlay.remove();
    }
  }

  // Start monitoring for new messages
  function startMessageMonitoring() {
    // Log what we're looking for to help with debugging
    window.electronAPI.logInfo("Starting message monitoring");

    // Create a mutation observer to watch for new messages
    const messageObserver = new MutationObserver((mutations) => {
      // We need to determine if the mutations contain new messages
      let newMessagesDetected = false;

      for (const mutation of mutations) {
        // Check if nodes were added
        if (mutation.addedNodes.length > 0) {
          // Check if any of the added nodes are message containers or contain message elements
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if this is a message element or contains message elements
              if (
                node.matches(MESSAGE_SELECTORS.CONTAINER) ||
                node.querySelector(MESSAGE_SELECTORS.CONTAINER)
              ) {
                newMessagesDetected = true;
                break;
              }
            }
          }
        }

        // Also check for modifications to existing messages (like added reactions)
        if (
          mutation.type === "attributes" ||
          mutation.type === "characterData"
        ) {
          const targetNode = mutation.target;
          if (targetNode.nodeType === Node.ELEMENT_NODE) {
            if (targetNode.closest(MESSAGE_SELECTORS.CONTAINER)) {
              newMessagesDetected = true;
              break;
            }
          }
        }

        if (newMessagesDetected) break;
      }

      // Log mutations for debugging in inspection mode
      if (config.INSPECTION_MODE) {
        window.electronAPI.logInfo(
          `Mutation detected: ${mutations.length} changes, new messages: ${newMessagesDetected}`
        );
      }

      if (isInPresentationMode && newMessagesDetected) {
        updatePresentationMessages();
      }

      // Check for alert emoji reactions even when not in presentation mode
      checkForAlertEmoji();
    });

    // Monitor the conversation panel for changes (container of all messages)
    const messageContainer =
      document.querySelector('[data-testid="conversation-panel-messages"]') ||
      document.querySelector(".message-list") ||
      document.querySelector('[role="application"]');

    if (messageContainer) {
      window.electronAPI.logInfo(
        "Message container found, observing for changes"
      );
      messageObserver.observe(messageContainer, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    } else {
      window.electronAPI.logInfo(
        "No message container found, will try again soon"
      );
      // Try again after a short delay
      setTimeout(startMessageMonitoring, 3000);
    }
  }

  // Get all message elements based on the provided HTML structure
  function getMessageElements() {
    // Try to get messages using the updated classes from the provided HTML
    let messageElements = document.querySelectorAll(
      "._amk4._amkd._amk5, ._amk4"
    );

    // If no messages found, try alternative selectors
    if (messageElements.length === 0) {
      messageElements = document.querySelectorAll(
        '[data-testid="msg-container"]'
      );
    }

    // Last resort fallbacks
    if (messageElements.length === 0) {
      messageElements = document.querySelectorAll('.message, [role="row"]');
    }

    return messageElements;
  }

  // Extract text content from a message element
  function getMessageText(messageElement) {
    // Try to get text using the updated class from the provided HTML
    let textElement =
      messageElement.querySelector("._ao3e.selectable-text.copyable-text") ||
      messageElement.querySelector("span._ao3e span") || // Added based on provided HTML
      messageElement.querySelector("span._ao3e") ||
      messageElement.querySelector(".selectable-text.copyable-text") ||
      messageElement.querySelector('[data-testid="balloon-text-content"]');

    // If found, check if this is a system message (like "TODAY")
    if (textElement) {
      // Check if this is a system message by looking at parent classes
      const isSystemMessage =
        messageElement.closest("._amjw._amk1._aotl") !== null || // System date markers like "TODAY"
        (textElement.parentElement &&
          textElement.parentElement.className === "_amkb") || // Another system message indicator
        messageElement.querySelector("._amk1") !== null; // Alternative system message check

      if (isSystemMessage) {
        // Mark system messages with a special property instead of returning null
        // This allows us to filter them out for display but not break other functionalities
        return "__SYSTEM_MESSAGE__";
      }

      // Process emojis in the message
      const emojiImages = textElement.querySelectorAll("img.emoji, .emoji");
      let textContent = textElement.textContent || "";

      // Replace emoji images with their alt text when available
      emojiImages.forEach((emojiImg) => {
        if (emojiImg.alt) {
          textContent += emojiImg.alt;
        }
      });

      return textContent;
    }

    // Fallback to the message element's text content
    return messageElement.textContent;
  }

  // Extract sender information from a message element
  function getMessageSender(messageElement) {
    // Try to get sender using data-pre-plain-text attribute which contains sender info
    const elementWithPrePlainText = messageElement.querySelector(
      "[data-pre-plain-text]"
    );
    if (elementWithPrePlainText) {
      const preText = elementWithPrePlainText.getAttribute(
        "data-pre-plain-text"
      );
      // Extract sender name from format like "[10:49 PM, 3/8/2025] Emmanuel Crown: "
      const match = preText.match(/\](.*?):/);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    // Try alternative selectors
    const senderElement =
      messageElement.querySelector('[data-testid="msg-meta"] span') ||
      messageElement.querySelector(".message-sender");

    return senderElement ? senderElement.textContent : "";
  }

  // Check if message is outgoing (sent by the user)
  function isOutgoingMessage(messageElement) {
    // Check for outgoing message indicators
    return (
      messageElement.classList.contains("message-out") ||
      messageElement.querySelector('[data-icon="msg-check"]') !== null ||
      messageElement.querySelector('[data-icon="msg-dblcheck"]') !== null ||
      messageElement.querySelector('[data-icon="msg-dblcheck-ack"]') !== null
    );
  }

  // Check for alert emoji in reactions
  function checkForAlertEmoji() {
    // Keep track of messages with alert emoji for popup functionality
    const messagesWithAlertEmoji = new Set();

    // Method 1: Find by reaction buttons using updated selectors from provided HTML
    const reactionButtons = document.querySelectorAll(
      'button[aria-label^="reaction"], button.xd7y6wv[aria-haspopup="true"][aria-label^="reaction"]'
    );

    // Check each reaction for the alert emoji
    reactionButtons.forEach((button) => {
      const ariaLabel = button.getAttribute("aria-label");
      if (ariaLabel && ariaLabel.includes(ALERT_EMOJI)) {
        // If we're in presentation mode, start flashing
        if (isInPresentationMode && !isFlashing) {
          startFlashing();
        }

        // For popup functionality - walk up to find the message container
        if (config.PRESENTATION.POPUP_ALERT_MESSAGES) {
          // First, try to find the container by walking up to the role="row" element
          let messageRow = button.closest('[role="row"]');
          if (!messageRow) {
            // Try with the container class from provided HTML
            messageRow =
              button.closest("._amk4._amkd._amk5") || button.closest("._amk4");
          }

          if (messageRow) {
            // Find the immediate child with data-id
            const messageContainer =
              messageRow.querySelector("[data-id]") || messageRow;
            const msgId =
              messageContainer.getAttribute("data-id") ||
              // Generate a pseudo-ID if no data-id is available
              `pseudo-${messageRow.textContent
                .trim()
                .substring(0, 20)}-${Date.now()}`;

            if (msgId) {
              window.electronAPI.logInfo(
                `Found message with alert emoji (by container), ID: ${msgId}`
              );
              messagesWithAlertEmoji.add(msgId);
            }
          } else {
            // Alternative method: Look for reaction container parent using classes from provided HTML
            const reactionContainer =
              button.closest(".x78zum5.x1n2onr6.xbfrwjf.x8k05lb") ||
              button.closest(".x78zum5.x1n2onr6") ||
              button.closest(".xpvyfi4") ||
              button.closest('[class*="reaction"]');

            if (reactionContainer) {
              // Go up to find the message item
              const messageItem =
                reactionContainer.closest("._amk4._amkd._amk5") ||
                reactionContainer.closest("._amk4") ||
                reactionContainer.parentElement;

              if (messageItem) {
                // Find the data-id container or use the element itself
                const messageContainer =
                  messageItem.querySelector("[data-id]") ||
                  (messageItem.getAttribute("data-id") ? messageItem : null) ||
                  messageItem.closest("[data-id]") ||
                  messageItem;

                const msgId =
                  messageContainer.getAttribute("data-id") ||
                  `pseudo-${messageItem.textContent
                    .trim()
                    .substring(0, 20)}-${Date.now()}`;

                if (msgId) {
                  window.electronAPI.logInfo(
                    `Found message with alert emoji (by parent), ID: ${msgId}`
                  );
                  messagesWithAlertEmoji.add(msgId);
                }
              }
            }
          }
        }
      }
    });

    // Method 2: Direct search for the emoji in the DOM
    // This handles cases where the emoji is part of the message content or reaction
    if (config.PRESENTATION.POPUP_ALERT_MESSAGES) {
      // Look for emoji images with the alert emoji
      const allEmojiImages = document.querySelectorAll(
        "img.emoji[alt='" + ALERT_EMOJI + "'], img[alt='" + ALERT_EMOJI + "']"
      );

      allEmojiImages.forEach((img) => {
        // Walk up to find the message container
        const messageRow = img.closest('[role="row"]');
        if (messageRow) {
          const messageContainer = messageRow.querySelector("[data-id]");
          if (messageContainer) {
            const msgId = messageContainer.getAttribute("data-id");
            if (msgId) {
              window.electronAPI.logInfo(
                `Found message with alert emoji (direct search), ID: ${msgId}`
              );
              messagesWithAlertEmoji.add(msgId);
            }
          }
        }
      });
    }

    // If in presentation mode and popup is enabled, update the presentation with highlighted alert messages
    if (
      isInPresentationMode &&
      config.PRESENTATION.POPUP_ALERT_MESSAGES &&
      messagesWithAlertEmoji.size > 0
    ) {
      window.electronAPI.logInfo(
        `Found ${messagesWithAlertEmoji.size} messages with alert emoji`
      );
      updatePresentationMessages(messagesWithAlertEmoji);
    }
  }

  // Start the flashing alert
  function startFlashing() {
    if (isFlashing) return;

    isFlashing = true;
    let flashState = false;

    // Show the stop flashing button
    const stopFlashingBtn = document.getElementById("stop-flashing-btn");
    if (stopFlashingBtn) {
      stopFlashingBtn.style.display = "inline-block";
    }

    // Get the container
    const container = document.getElementById(FULL_SCREEN_CONTAINER_ID);
    if (!container) return;

    // Set up flashing interval
    flashingInterval = setInterval(() => {
      flashState = !flashState;
      container.style.backgroundColor = flashState ? "#d33" : "#1f2c34";
    }, 500); // Flash every 500ms
  }

  // Stop the flashing alert
  function stopFlashing() {
    if (!isFlashing) return;

    isFlashing = false;

    // Clear the interval
    if (flashingInterval) {
      clearInterval(flashingInterval);
      flashingInterval = null;
    }

    // Hide the stop flashing button
    const stopFlashingBtn = document.getElementById("stop-flashing-btn");
    if (stopFlashingBtn) {
      stopFlashingBtn.style.display = "none";
    }

    // Reset container background
    const container = document.getElementById(FULL_SCREEN_CONTAINER_ID);
    if (container) {
      container.style.backgroundColor = "#1f2c34";
    }
  }

  // Update presentation messages with the most recent messages
  function updatePresentationMessages(alertMessages = new Set()) {
    if (!isInPresentationMode) return;

    const presentationContainer = document.getElementById(
      "presentation-messages"
    );
    if (!presentationContainer) return;

    // Get recent messages
    const messageElements = getMessageElements();

    // Use config value for max messages
    const maxMessages = config.PRESENTATION.MAX_MESSAGES || 5;

    // Get the most recent messages (limited by config)
    const recentMessages = Array.from(messageElements).slice(-maxMessages);

    if (recentMessages.length === 0) {
      window.electronAPI.logInfo(
        "No message elements found in updatePresentationMessages"
      );
      return;
    }

    // Check for new messages by comparing with the last processed set
    const currentMessageIds = new Set();
    let hasNewMessages = false;

    recentMessages.forEach((msg) => {
      // Create a fingerprint for this message (combining text and timestamp if available)
      const msgText = getMessageText(msg) || "";
      const timeElement = msg.querySelector(MESSAGE_SELECTORS.TIMESTAMP);
      const timestamp = timeElement ? timeElement.textContent : "";
      const fingerprint = `${msgText}-${timestamp}`;

      currentMessageIds.add(fingerprint);

      // If this message wasn't in our last set, it's new
      if (!lastProcessedMessages.has(fingerprint)) {
        hasNewMessages = true;
      }
    });

    // If no new messages and we're not forcing an update due to alert messages,
    // then we can skip the update
    if (
      !hasNewMessages &&
      alertMessages.size === 0 &&
      lastProcessedMessages.size > 0
    ) {
      return;
    }

    // Update our tracking set for next time
    lastProcessedMessages = currentMessageIds;

    window.electronAPI.logInfo(
      `Found ${recentMessages.length} message elements, new messages: ${hasNewMessages}`
    );

    // Log alert messages for debugging if in inspection mode
    if (config.INSPECTION_MODE && alertMessages.size > 0) {
      window.electronAPI.logInfo(
        `Alert messages IDs: ${Array.from(alertMessages).join(", ")}`
      );
    }

    // Clear the container (except for fixed elements)
    presentationContainer.innerHTML = "";

    // Add messages to presentation view
    recentMessages.forEach((msg) => {
      // Get message text using the helper function
      const msgText = getMessageText(msg);

      // Skip if the message is a system message
      if (msgText === "__SYSTEM_MESSAGE__") return;

      // Get sender info using the helper function
      const sender = getMessageSender(msg);

      // Check if message is outgoing
      const isOutgoing = isOutgoingMessage(msg);

      // Check if this message has the alert emoji (for popup highlight)
      const msgId = msg.dataset.id || msg.getAttribute("data-id");

      // Debug message IDs if in inspection mode
      if (config.INSPECTION_MODE) {
        window.electronAPI.logInfo(`Processing message with ID: ${msgId}`);
      }

      const hasAlertEmoji = msgId && alertMessages.has(msgId);

      // Get message font size from config
      const messageFontSize = config.PRESENTATION.MESSAGE_FONT_SIZE || 36;

      // Calculate popup size (larger if it has alert emoji)
      const fontSize = hasAlertEmoji ? messageFontSize * 1.5 : messageFontSize;
      const popupScale = hasAlertEmoji ? 1.2 : 1;

      // Create presentation message element
      const presentationMsg = document.createElement("div");
      presentationMsg.style.cssText = `
        background-color: ${
          hasAlertEmoji ? "#b71c1c" : isOutgoing ? "#005c4b" : "#202c33"
        };
        border-radius: 10px;
        padding: 20px;
        margin-bottom: 20px;
        font-size: ${fontSize}px;
        word-wrap: break-word;
        max-width: ${hasAlertEmoji ? "90%" : "80%"};
        align-self: ${isOutgoing ? "flex-end" : "flex-start"};
        transform: scale(${popupScale});
        transition: transform 0.3s ease-in-out;
        ${hasAlertEmoji ? "box-shadow: 0 0 15px rgba(255, 0, 0, 0.7);" : ""}
        ${hasAlertEmoji ? "z-index: 10;" : ""}
      `;

      // Add sender name if available
      if (sender) {
        const senderFontSize = hasAlertEmoji ? 30 : 24;
        presentationMsg.innerHTML = `<div style="font-size: ${senderFontSize}px; color: #00a884; margin-bottom: 10px;">${sender}</div>`;
      }

      // Add message text
      presentationMsg.innerHTML += `<div>${msgText}</div>`;

      // Add alert emoji indicator if this message has it
      if (hasAlertEmoji) {
        presentationMsg.innerHTML += `<div style="margin-top: 15px; font-size: ${messageFontSize}px;">${ALERT_EMOJI} Alert Message ${ALERT_EMOJI}</div>`;
      }

      presentationContainer.appendChild(presentationMsg);
    });

    // Scroll to bottom
    presentationContainer.scrollTop = presentationContainer.scrollHeight;
  }

  // Start the initialization after a short delay to ensure WhatsApp Web has loaded
  setTimeout(initialize, 5000);

  // Listen for IPC messages from the main process
  if (window.electronAPI) {
    // Listen for configuration changes
    window.electronAPI.onConfigUpdate(updateConfigFromMain);

    // Listen for presentation mode toggle from menu
    window.electronAPI.onTogglePresentationMode(() => {
      if (window.electronAPI) {
        window.electronAPI.logInfo(
          "Received toggle presentation mode command from menu"
        );
      }

      // Toggle presentation mode
      togglePresentationMode();
    });
  }
})();
