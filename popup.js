(() => {
  "use strict";

  const CE = globalThis.CE;
  if (!CE) {
    console.error("[Conversation Extractor] CE namespace missing");
    return;
  }

  const formatSelect = document.getElementById("exportFormat");
  const fastModeCheckbox = document.getElementById("fastModeEnabled");
  const statusText = document.getElementById("statusText");

  function setStatus(message) {
    statusText.textContent = message;
  }

  async function loadSettings() {
    // Drop legacy Claudifier key if present from older builds.
    await chrome.storage.local.remove("claudeThemeEnabled");

    const stored = await chrome.storage.local.get(CE.STORAGE_DEFAULTS);
    const selected = CE.isFormatId(stored.exportFormat)
      ? stored.exportFormat
      : CE.DEFAULT_FORMAT_ID;
    CE.populateFormatSelect(formatSelect, selected);

    if (stored.exportFormat !== selected) {
      await chrome.storage.local.set({ exportFormat: selected });
    }

    fastModeCheckbox.checked = stored.fastModeEnabled !== false;
  }

  fastModeCheckbox.addEventListener("change", async () => {
    const fastModeEnabled = fastModeCheckbox.checked;
    await chrome.storage.local.set({ fastModeEnabled });
    setStatus(
      fastModeEnabled
        ? "Fast Mode on — uses site APIs, falls back to Slow Mode if needed."
        : "Slow Mode on — DOM scroll scrape only."
    );
  });

  formatSelect.addEventListener("change", async () => {
    const exportFormat = formatSelect.value;
    if (!CE.isFormatId(exportFormat)) {
      setStatus("Unknown export format.");
      return;
    }
    await chrome.storage.local.set({ exportFormat });
    const format = CE.getFormat(exportFormat);
    setStatus(`Export format set to ${format.label}.`);
  });

  loadSettings().catch((error) => {
    console.error("[Conversation Extractor] Failed to load settings", error);
    setStatus("Could not load settings.");
  });
})();
