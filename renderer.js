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

  // Initialize when the DOM is fully loaded
  function initialize() {
    console.log("WhatsApp Presentation Mode: Initializing...");

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

    // Create our button
    const button = document.createElement("button");
    button.id = PRESENTATION_MODE_BUTTON_ID;
    button.innerHTML = "📺 Present";
    button.title = "Enter Presentation Mode";
    button.style.cssText = `
      background-color: #00a884;
      color: white;
      border: none;
      border-radius: 3px;
      padding: 6px 12px;
      margin-right: 10px;
      cursor: pointer;
      font-size: 14px;
    `;

    // Add click event
    button.addEventListener("click", togglePresentationMode);

    // Add to header
    header.appendChild(button);

    // Add inspection mode button if inspection is enabled
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
        margin-right: 10px;
        cursor: pointer;
        font-size: 14px;
      `;

      // Add click event
      inspectionButton.addEventListener("click", toggleInspectionMode);

      // Add to header
      header.appendChild(inspectionButton);
    }

    // Start monitoring messages
    startMessageMonitoring();
  }

  // Toggle presentation mode on/off
  function togglePresentationMode() {
    if (isInPresentationMode) {
      exitPresentationMode();
    } else {
      enterPresentationMode();
    }
  }

  // Enter presentation mode
  function enterPresentationMode() {
    if (!mainContainer) return;

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
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; background-color: #00a884;">
        <h1 style="margin: 0; font-size: 24px;">${chatTitle} - Presentation Mode</h1>
        <div>
          <button id="stop-flashing-btn" style="background-color: #d33; color: white; border: none; border-radius: 3px; padding: 6px 12px; margin-right: 10px; display: none; cursor: pointer;">Stop Flashing</button>
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

    // Enter fullscreen if possible
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen();
    }

    // Update button text
    const presentButton = document.getElementById(PRESENTATION_MODE_BUTTON_ID);
    if (presentButton) {
      presentButton.innerHTML = "📺 Exit Present";
      presentButton.title = "Exit Presentation Mode";
    }

    isInPresentationMode = true;
    currentChat = chatTitle;

    // Update with existing messages
    updatePresentationMessages();
  }

  // Exit presentation mode
  function exitPresentationMode() {
    const container = document.getElementById(FULL_SCREEN_CONTAINER_ID);
    if (container) {
      container.remove();
    }

    // Exit fullscreen if we're in it
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen();
    }

    // Update button text
    const presentButton = document.getElementById(PRESENTATION_MODE_BUTTON_ID);
    if (presentButton) {
      presentButton.innerHTML = "📺 Present";
      presentButton.title = "Enter Presentation Mode";
    }

    // Stop any flashing
    stopFlashing();

    isInPresentationMode = false;
    currentChat = null;
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
})();
