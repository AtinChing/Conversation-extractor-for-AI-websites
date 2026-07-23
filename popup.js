(() => {
  "use strict";

  const CE = globalThis.CE;
  if (!CE) {
    console.error("[Conversation Extractor] CE namespace missing");
    return;
  }

  const formatSelect = document.getElementById("exportFormat");
  const fastModeCheckbox = document.getElementById("fastModeEnabled");
  const floatingButtonCheckbox = document.getElementById("floatingButtonVisible");
  const resetBlobPositionButton = document.getElementById("resetBlobPosition");
  const downloadButton = document.getElementById("downloadTranscript");
  const statusText = document.getElementById("statusText");

  function setStatus(message, tone = "default") {
    statusText.textContent = message;
    statusText.dataset.tone = tone === "default" ? "" : tone;
  }

  function isMissingContentScriptError(error) {
    const message = String(error?.message || error || "");
    return (
      message.includes("Receiving end does not exist") ||
      message.includes("Could not establish connection")
    );
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
    floatingButtonCheckbox.checked = stored.floatingButtonVisible !== false;
  }

  fastModeCheckbox.addEventListener("change", async () => {
    const fastModeEnabled = fastModeCheckbox.checked;
    await chrome.storage.local.set({ fastModeEnabled });
    setStatus(
      fastModeEnabled
        ? "Fast Mode (API) on — falls back to Slow Mode automatically if needed."
        : "Slow Mode only — DOM scroll scrape (Fast Mode disabled)."
    );
  });

  floatingButtonCheckbox.addEventListener("change", async () => {
    const floatingButtonVisible = floatingButtonCheckbox.checked;
    await chrome.storage.local.set({ floatingButtonVisible });
    setStatus(
      floatingButtonVisible
        ? "On-page button shown on supported chat tabs."
        : "On-page button hidden."
    );
  });

  resetBlobPositionButton.addEventListener("click", async () => {
    await chrome.storage.local.set({ floatingButtonPosition: null });
    setStatus("On-page button position reset to default.");
  });

  formatSelect.addEventListener("change", async () => {
    const exportFormat = formatSelect.value;
    if (!CE.isFormatId(exportFormat)) {
      setStatus("Unknown export format.", "error");
      return;
    }
    await chrome.storage.local.set({ exportFormat });
    const format = CE.getFormat(exportFormat);
    setStatus(`Export format set to ${format.label}.`);
  });

  downloadButton.addEventListener("click", async () => {
    downloadButton.disabled = true;
    setStatus("Exporting…");

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setStatus("No active tab found.", "error");
        return;
      }

      const response = await chrome.tabs.sendMessage(tab.id, { type: "ce-export" });

      if (response?.ok) {
        const count = response.messageCount ?? 0;
        const modeLabel = response.exportMode === "fast" ? "Fast Mode" : "Slow Mode";
        setStatus(
          `Saved ${count} message${count === 1 ? "" : "s"} (${modeLabel}).`,
          "success"
        );
        return;
      }

      setStatus(response?.error || "Export failed.", "error");
    } catch (error) {
      console.error("[Conversation Extractor] Popup export failed", error);
      if (isMissingContentScriptError(error)) {
        setStatus(
          "Open a ChatGPT, Claude, or Gemini conversation tab and try again.",
          "error"
        );
      } else {
        setStatus(`Export failed — ${String(error?.message || error)}`, "error");
      }
    } finally {
      downloadButton.disabled = false;
    }
  });

  loadSettings().catch((error) => {
    console.error("[Conversation Extractor] Failed to load settings", error);
    setStatus("Could not load settings.", "error");
  });
})();
