const DEFAULTS = {
  claudeThemeEnabled: false,
  exportFormat: "markdown"
};

const themeToggle = document.getElementById("claudeThemeToggle");
const formatSelect = document.getElementById("exportFormat");
const statusText = document.getElementById("statusText");

function setStatus(message) {
  statusText.textContent = message;
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  themeToggle.checked = Boolean(stored.claudeThemeEnabled);
  formatSelect.value = stored.exportFormat === "json" ? "json" : "markdown";
}

async function saveSettings(partial) {
  await chrome.storage.local.set(partial);
}

themeToggle.addEventListener("change", async () => {
  const claudeThemeEnabled = themeToggle.checked;
  await saveSettings({ claudeThemeEnabled });
  setStatus(
    claudeThemeEnabled
      ? "Claude theme enabled for ChatGPT tabs."
      : "Claude theme disabled."
  );
});

formatSelect.addEventListener("change", async () => {
  const exportFormat = formatSelect.value === "json" ? "json" : "markdown";
  await saveSettings({ exportFormat });
  setStatus(`Export format set to ${exportFormat === "json" ? "JSON" : "Markdown"}.`);
});

loadSettings().catch((error) => {
  console.error("[Conversation Extractor] Failed to load settings", error);
  setStatus("Could not load settings.");
});
