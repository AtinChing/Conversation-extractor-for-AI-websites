(() => {
  "use strict";

  const CE = globalThis.CE;
  if (!CE) {
    console.error("[Conversation Extractor] CE namespace missing — check manifest script order");
    return;
  }

  const BUTTON_ID = "ce-download-transcript";
  const ROOT_ID = "ce-float-root";
  const PLATFORM = detectPlatform();
  if (!PLATFORM) return;

  let exportFormat = CE.DEFAULT_FORMAT_ID;
  let fastModeEnabled = true;
  let floatingButtonVisible = true;
  /** @type {{ left: number, top: number } | null} */
  let floatingButtonPosition = null;
  let exportBusy = false;
  let injectScheduled = false;
  let dragMoved = false;

  // Shared with Claude scraper module
  CE.serializeRichContent = serializeRichContent;

  init();

  function detectPlatform() {
    const host = location.hostname;
    if (host === "chatgpt.com" || host.endsWith(".chatgpt.com")) return "chatgpt";
    if (host === "claude.ai" || host.endsWith(".claude.ai")) return "claude";
    if (host === "gemini.google.com" || host.endsWith(".gemini.google.com")) {
      return "gemini";
    }
    return null;
  }

  async function init() {
    const settings = await chrome.storage.local.get(CE.STORAGE_DEFAULTS);
    exportFormat = CE.isFormatId(settings.exportFormat)
      ? settings.exportFormat
      : CE.DEFAULT_FORMAT_ID;
    fastModeEnabled = settings.fastModeEnabled !== false;
    floatingButtonVisible = settings.floatingButtonVisible !== false;
    floatingButtonPosition = normalizePosition(settings.floatingButtonPosition);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.exportFormat) {
        const next = changes.exportFormat.newValue;
        exportFormat = CE.isFormatId(next) ? next : CE.DEFAULT_FORMAT_ID;
      }
      if (changes.fastModeEnabled) {
        fastModeEnabled = changes.fastModeEnabled.newValue !== false;
      }
      if (changes.floatingButtonVisible) {
        floatingButtonVisible = changes.floatingButtonVisible.newValue !== false;
        if (floatingButtonVisible) {
          ensureButton();
        } else {
          hideButton();
        }
      }
      if (changes.floatingButtonPosition) {
        floatingButtonPosition = normalizePosition(
          changes.floatingButtonPosition.newValue
        );
        applyButtonPosition(document.getElementById(ROOT_ID));
      }
    });

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "ce-export") return;

      if (exportBusy) {
        sendResponse({ ok: false, error: "Export already in progress" });
        return;
      }

      exportBusy = true;
      const button = document.getElementById(BUTTON_ID);

      runExport((status) => {
        if (button) setButtonStatus(button, status);
      })
        .then((result) => {
          sendResponse({
            ok: true,
            messageCount: result.messageCount,
            exportMode: result.exportMode
          });
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error?.message || String(error)
          });
        })
        .finally(() => {
          exportBusy = false;
          if (button) clearButtonStatus(button);
        });

      return true;
    });

    ensureButton();
    observeDom();
  }

  function observeDom() {
    const observer = new MutationObserver(() => scheduleButtonInject());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener("popstate", scheduleButtonInject);
    window.addEventListener("hashchange", scheduleButtonInject);

    const pushState = history.pushState;
    const replaceState = history.replaceState;
    history.pushState = function (...args) {
      const result = pushState.apply(this, args);
      scheduleButtonInject();
      return result;
    };
    history.replaceState = function (...args) {
      const result = replaceState.apply(this, args);
      scheduleButtonInject();
      return result;
    };
  }

  function scheduleButtonInject() {
    if (injectScheduled) return;
    injectScheduled = true;
    requestAnimationFrame(() => {
      injectScheduled = false;
      ensureButton();
    });
  }

  function hideButton() {
    document.getElementById(ROOT_ID)?.remove();
  }

  function ensureButton() {
    if (!floatingButtonVisible) {
      hideButton();
      return;
    }

    let root = document.getElementById(ROOT_ID);
    let button = document.getElementById(BUTTON_ID);

    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      root.className = "ce-float-root";
    }

    if (!button) {
      button = document.createElement("button");
      button.id = BUTTON_ID;
      button.type = "button";
      button.setAttribute("aria-label", "Download Transcript");
      button.title = "Drag to move · Click to download";
      button.innerHTML = `
        <svg class="ce-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M8 1.5a.75.75 0 0 1 .75.75v6.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 1.06-1.06l2.22 2.22V2.25A.75.75 0 0 1 8 1.5Zm-4.75 10a.75.75 0 0 0 0 1.5h9.5a.75.75 0 0 0 0-1.5h-9.5Z"/>
        </svg>
        <span class="ce-status" aria-live="polite"></span>
      `;
      button.addEventListener("click", onDownloadClick);
      root.appendChild(button);

      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "ce-dismiss";
      dismiss.setAttribute("aria-label", "Hide download button");
      dismiss.innerHTML = `
        <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M2.22 2.22a.75.75 0 0 1 1.06 0L6 4.94l2.72-2.72a.75.75 0 1 1 1.06 1.06L7.06 6l2.72 2.72a.75.75 0 0 1-1.06 1.06L6 7.06l-2.72 2.72a.75.75 0 0 1-1.06-1.06L4.94 6 2.22 3.28a.75.75 0 0 1 0-1.06Z"/>
        </svg>
      `;
      dismiss.addEventListener("click", onDismissClick);
      root.appendChild(dismiss);
    } else if (!root.contains(button)) {
      root.appendChild(button);
      if (!root.querySelector(".ce-dismiss")) {
        const dismiss = document.createElement("button");
        dismiss.type = "button";
        dismiss.className = "ce-dismiss";
        dismiss.setAttribute("aria-label", "Hide download button");
        dismiss.innerHTML = `
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M2.22 2.22a.75.75 0 0 1 1.06 0L6 4.94l2.72-2.72a.75.75 0 1 1 1.06 1.06L7.06 6l2.72 2.72a.75.75 0 0 1-1.06 1.06L6 7.06l-2.72 2.72a.75.75 0 0 1-1.06-1.06L4.94 6 2.22 3.28a.75.75 0 0 1 0-1.06Z"/>
          </svg>
        `;
        dismiss.addEventListener("click", onDismissClick);
        root.appendChild(dismiss);
      }
    }

    if (button && button.dataset.ceDragBound !== "1") {
      button.title = "Drag to move · Click to download";
      button.addEventListener("pointerdown", onDragPointerDown);
      button.dataset.ceDragBound = "1";
    }

    applyButtonPosition(root);

    if (!document.body.contains(root) && document.body) {
      document.body.appendChild(root);
    }
  }

  function normalizePosition(value) {
    if (!value || typeof value !== "object") return null;
    const left = Number(value.left);
    const top = Number(value.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    return { left, top };
  }

  function applyButtonPosition(root) {
    if (!root) return;
    if (floatingButtonPosition) {
      const clamped = clampPosition(
        floatingButtonPosition.left,
        floatingButtonPosition.top,
        root
      );
      root.style.left = `${clamped.left}px`;
      root.style.top = `${clamped.top}px`;
      root.style.right = "auto";
      root.dataset.dragged = "true";
    } else {
      root.style.left = "";
      root.style.top = "";
      root.style.right = "";
      delete root.dataset.dragged;
    }
  }

  function clampPosition(left, top, root) {
    const width = root?.offsetWidth || 44;
    const height = root?.offsetHeight || 44;
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, window.innerHeight - height - 8);
    return {
      left: Math.min(Math.max(8, left), maxLeft),
      top: Math.min(Math.max(8, top), maxTop)
    };
  }

  function onDragPointerDown(event) {
    if (event.button !== 0) return;
    if (event.target?.closest?.(".ce-dismiss")) return;

    const root = document.getElementById(ROOT_ID);
    const button = document.getElementById(BUTTON_ID);
    if (!root || !button || exportBusy) return;

    const rect = root.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    dragMoved = false;

    root.dataset.dragging = "true";
    button.setPointerCapture?.(event.pointerId);

    const onMove = (moveEvent) => {
      const next = clampPosition(
        moveEvent.clientX - offsetX,
        moveEvent.clientY - offsetY,
        root
      );
      if (
        Math.abs(next.left - rect.left) > 3 ||
        Math.abs(next.top - rect.top) > 3
      ) {
        dragMoved = true;
      }
      root.style.left = `${next.left}px`;
      root.style.top = `${next.top}px`;
      root.style.right = "auto";
      root.dataset.dragged = "true";
      floatingButtonPosition = next;
    };

    const onUp = async (upEvent) => {
      button.releasePointerCapture?.(upEvent.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      delete root.dataset.dragging;

      if (!dragMoved || !floatingButtonPosition) return;

      try {
        await chrome.storage.local.set({
          floatingButtonPosition: { ...floatingButtonPosition }
        });
      } catch (error) {
        console.error("[Conversation Extractor] Failed to persist button position", error);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  async function onDismissClick(event) {
    event.preventDefault();
    event.stopPropagation();

    floatingButtonVisible = false;
    hideButton();

    try {
      await chrome.storage.local.set({ floatingButtonVisible: false });
    } catch (error) {
      console.error("[Conversation Extractor] Failed to persist dismiss", error);
    }
  }

  function setButtonStatus(button, text) {
    const status = button.querySelector(".ce-status");
    if (status) status.textContent = text;
    button.dataset.showStatus = "true";
    if (text) button.setAttribute("aria-label", text);
  }

  function clearButtonStatus(button) {
    const status = button.querySelector(".ce-status");
    if (status) status.textContent = "";
    delete button.dataset.showStatus;
    delete button.dataset.busy;
    button.setAttribute("aria-label", "Download Transcript");
  }

  function flashButtonStatus(button, message) {
    setButtonStatus(button, message);
    window.setTimeout(() => {
      clearButtonStatus(button);
    }, 1600);
  }

  async function onDownloadClick(event) {
    event.preventDefault();
    event.stopPropagation();

    // Ignore click that ends a drag.
    if (dragMoved) {
      dragMoved = false;
      return;
    }

    const button = document.getElementById(BUTTON_ID);
    if (!button || exportBusy) return;

    exportBusy = true;
    button.dataset.busy = "true";

    try {
      const result = await runExport((status) => {
        setButtonStatus(button, status);
      });
      const modeTag = result.exportMode === "fast" ? "fast" : "slow";
      flashButtonStatus(button, `Saved ${result.messageCount} (${modeTag})`);
    } catch (error) {
      console.error("[Conversation Extractor] Export failed", error);
      flashButtonStatus(button, error?.message || "Export failed");
    } finally {
      exportBusy = false;
      delete button.dataset.busy;
    }
  }

  async function runExport(onStatus) {
    onStatus?.(fastModeEnabled ? "Fast export…" : "Scanning…");
    const conversation = await scrapeConversation(onStatus);

    if (!conversation.messages.length) {
      throw new Error("No messages found");
    }

    const format =
      CE.getFormat(exportFormat) || CE.getFormat(CE.DEFAULT_FORMAT_ID);
    if (!format) {
      throw new Error("No format registered");
    }

    onStatus?.("Exporting…");
    const payload = format.serialize(conversation);
    CE.downloadFile(
      `${CE.slugify(conversation.title)}.${format.extension}`,
      payload,
      format.mime
    );

    return {
      messageCount: conversation.messages.length,
      exportMode: conversation.exportMode
    };
  }

  async function scrapeConversation(onStatus) {
    const titleHint = getConversationTitle();
    let messages = [];
    let exportMode = "slow";
    let title = titleHint;

    if (fastModeEnabled && typeof CE.scrapeFast === "function") {
      try {
        onStatus?.("Fast export…");
        messages = await CE.scrapeFast(PLATFORM);
        exportMode = "fast";
        if (CE._fastTitleHint) {
          title = CE._fastTitleHint;
          CE._fastTitleHint = "";
        }
      } catch (error) {
        console.warn(
          "[Conversation Extractor] Fast mode failed; falling back to slow scrape",
          error
        );
        onStatus?.("Fast failed → slow…");
        messages = await scrapeSlow();
        exportMode = "slow";
      }
    } else {
      onStatus?.("Scanning…");
      messages = await scrapeSlow();
    }

    return {
      platform: PLATFORM,
      title,
      url: location.href,
      exportedAt: new Date().toISOString(),
      exportMode,
      messages
    };
  }

  async function scrapeSlow() {
    if (PLATFORM === "chatgpt" && typeof CE.scrapeChatGPTFull === "function") {
      return CE.scrapeChatGPTFull();
    }
    if (PLATFORM === "claude" && typeof CE.scrapeClaudeFull === "function") {
      return CE.scrapeClaudeFull();
    }
    if (PLATFORM === "gemini" && typeof CE.scrapeGeminiFull === "function") {
      return CE.scrapeGeminiFull();
    }
    return [];
  }

  function getConversationTitle() {
    const candidates = [
      document.querySelector("title")?.textContent,
      document.querySelector("h1")?.textContent,
      document.querySelector('[data-testid="conversation-title"]')?.textContent,
      document.querySelector('[data-testid="chat-title"]')?.textContent,
      document.querySelector("[data-test-id='conversation-title']")?.textContent
    ];

    for (const raw of candidates) {
      const cleaned = cleanTitle(raw);
      if (cleaned) return cleaned;
    }

    if (PLATFORM === "chatgpt") return "ChatGPT Conversation";
    if (PLATFORM === "gemini") return "Gemini Conversation";
    return "Claude Conversation";
  }

  function cleanTitle(raw) {
    if (!raw) return "";
    let title = String(raw).replace(/\s+/g, " ").trim();
    title = title
      .replace(/\s*[|–—-]\s*ChatGPT\s*$/i, "")
      .replace(/\s*[|–—-]\s*Claude\s*$/i, "")
      .replace(/\s*-\s*Claude\s*$/i, "")
      .replace(/\s*[|–—-]\s*Gemini.*$/i, "")
      .replace(/\s*-\s*Gemini.*$/i, "")
      .trim();
    return title;
  }

  function serializeRichContent(root) {
    if (!root) return "";
    const working = root.cloneNode(true);
    working
      .querySelectorAll(
        "button, [role='button'], svg, style, script, noscript, [data-testid*='feedback'], [aria-label*='Copy'], [aria-label*='Good response'], [aria-label*='Bad response']"
      )
      .forEach((el) => el.remove());

    return walkNodes(working).replace(/\n{3,}/g, "\n\n").trim();
  }

  function walkNodes(node) {
    let out = "";

    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent.replace(/\s+/g, " ");
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;

      const el = child;
      const tag = el.tagName.toLowerCase();

      if (tag === "br") {
        out += "\n";
        return;
      }

      if (tag === "pre") {
        const code = el.querySelector("code");
        const language = detectLanguage(code || el);
        const codeText = (code ? code.textContent : el.textContent) || "";
        out += `\n\n\`\`\`${language}\n${trimCode(codeText)}\n\`\`\`\n\n`;
        return;
      }

      if (tag === "code" && el.parentElement?.tagName.toLowerCase() !== "pre") {
        out += "`" + (el.textContent || "").replace(/`/g, "\\`") + "`";
        return;
      }

      if (/^h[1-6]$/.test(tag)) {
        const level = Number(tag[1]);
        out += `\n\n${"#".repeat(level)} ${inlineText(el)}\n\n`;
        return;
      }

      if (tag === "p") {
        out += `\n\n${inlineText(el)}\n\n`;
        return;
      }

      if (tag === "blockquote") {
        const quoted = walkNodes(el)
          .trim()
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n");
        out += `\n\n${quoted}\n\n`;
        return;
      }

      if (tag === "ul" || tag === "ol") {
        const items = [...el.children].filter((li) => li.tagName.toLowerCase() === "li");
        items.forEach((li, index) => {
          const marker = tag === "ol" ? `${index + 1}.` : "-";
          out += `\n${marker} ${inlineText(li).trim()}`;
        });
        out += "\n\n";
        return;
      }

      if (tag === "li") {
        out += `\n- ${inlineText(el).trim()}`;
        return;
      }

      if (tag === "a") {
        const href = el.getAttribute("href") || "";
        const text = inlineText(el).trim() || href;
        out += href ? `[${text}](${href})` : text;
        return;
      }

      if (tag === "hr") {
        out += "\n\n---\n\n";
        return;
      }

      if (tag === "table") {
        out += `\n\n${tableToMarkdown(el)}\n\n`;
        return;
      }

      if (tag === "img") {
        const alt = el.getAttribute("alt") || "image";
        const src = el.getAttribute("src") || "";
        out += src ? ` ![${alt}](${src}) ` : ` ${alt} `;
        return;
      }

      out += walkNodes(el);
    });

    return out;
  }

  function inlineText(el) {
    return walkNodes(el).replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  }

  function detectLanguage(codeEl) {
    if (!codeEl) return "";
    const className = codeEl.className || "";
    const match =
      className.match(/language-([a-z0-9+#.-]+)/i) ||
      className.match(/lang-([a-z0-9+#.-]+)/i);
    if (match) return match[1].toLowerCase();

    const dataLang =
      codeEl.getAttribute("data-language") ||
      codeEl.getAttribute("data-lang") ||
      codeEl.parentElement?.getAttribute("data-language") ||
      "";
    return String(dataLang).trim().toLowerCase();
  }

  function trimCode(text) {
    return String(text).replace(/^\n+/, "").replace(/\n+$/, "");
  }

  function tableToMarkdown(table) {
    const rows = [...table.querySelectorAll("tr")].map((tr) =>
      [...tr.children].map((cell) =>
        (cell.textContent || "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim()
      )
    );
    if (!rows.length) return "";

    const header = rows[0];
    const body = rows.slice(1);
    const sep = header.map(() => "---");
    const lines = [
      `| ${header.join(" | ")} |`,
      `| ${sep.join(" | ")} |`,
      ...body.map((row) => `| ${row.join(" | ")} |`)
    ];
    return lines.join("\n");
  }

})();
