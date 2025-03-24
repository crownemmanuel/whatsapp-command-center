const { contextBridge, ipcRenderer } = require("electron");

// Expose specific Electron APIs to the PIN validation window
contextBridge.exposeInMainWorld("pinAPI", {
  // Validate PIN with main process
  validatePin: (pin) => ipcRenderer.send("validate-pin", pin),

  // Handle cancel button
  cancelValidation: () => ipcRenderer.send("cancel-pin-validation"),

  // Handle forgot PIN
  forgotPin: () => ipcRenderer.send("forgot-pin"),

  // Listen for validation results
  onValidationResult: (callback) =>
    ipcRenderer.on("pin-validation-result", (event, result) =>
      callback(result)
    ),
});

// When the window loads, set up the validation result listener
window.addEventListener("DOMContentLoaded", () => {
  // Listen for validation results and show error messages
  ipcRenderer.on("pin-validation-result", (event, result) => {
    if (!result.success) {
      const errorElement = document.getElementById("error-message");
      if (errorElement) {
        errorElement.textContent = result.message;

        // Clear error after 3 seconds
        setTimeout(() => {
          errorElement.textContent = "";
        }, 3000);
      }

      // Clear the input and focus it
      const pinInput = document.getElementById("pin-input");
      if (pinInput) {
        pinInput.value = "";
        pinInput.focus();
      }
    }
  });

  // Listen for pin reset status updates
  ipcRenderer.on("pin-reset-completed", (event) => {
    // The main process will handle the window closure and app reload
  });
});
