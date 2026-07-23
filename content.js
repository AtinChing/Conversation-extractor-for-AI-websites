(() => {
  "use strict";

  const CE = globalThis.CE;
  if (!CE) {
    console.error("[Conversation Extractor] CE namespace missing — check manifest script order");
    return;
  }

  const BUTTON_ID = "ce-download-transcript";
  const PLATFORM = detectPlatform();
  if (!PLATFORM) return;

  let exportFormat = CE.DEFAULT_FORMAT_ID;
  let fastModeEnabled = true;
  let injectScheduled = false;

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

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.exportFormat) {
        const next = changes.exportFormat.newValue;
        exportFormat = CE.isFormatId(next) ? next : CE.DEFAULT_FORMAT_ID;
      }
      if (changes.fastModeEnabled) {
        fastModeEnabled = changes.fastModeEnabled.newValue !== false;
      }
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

  function ensureButton() {
    let button = document.getElementById(BUTTON_ID);
    if (!button) {
      button = document.createElement("button");
      button.id = BUTTON_ID;
      button.type = "button";
      button.setAttribute("aria-label", "Download Transcript");
      button.innerHTML = `
        <svg class="ce-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M8 1.5a.75.75 0 0 1 .75.75v6.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 1.06-1.06l2.22 2.22V2.25A.75.75 0 0 1 8 1.5Zm-4.75 10a.75.75 0 0 0 0 1.5h9.5a.75.75 0 0 0 0-1.5h-9.5Z"/>
        </svg>
        <span class="ce-label">Download Transcript</span>
      `;
      button.addEventListener("click", onDownloadClick);
      document.documentElement.appendChild(button);
    }

    if (!document.body.contains(button) && document.body) {
      document.body.appendChild(button);
    }
  }

  async function onDownloadClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const button = document.getElementById(BUTTON_ID);
    if (!button || button.dataset.busy === "true") return;

    button.dataset.busy = "true";
    const label = button.querySelector(".ce-label");
    const previous = label ? label.textContent : "Download Transcript";
    if (label) label.textContent = "Exporting…";

    try {
      if (label) {
        label.textContent = fastModeEnabled ? "Fast export…" : "Scanning…";
      }
      const conversation = await scrapeConversation((status) => {
        if (label) label.textContent = status;
      });
      if (!conversation.messages.length) {
        flashLabel(label, "No messages found", previous);
        return;
      }

      const format =
        CE.getFormat(exportFormat) || CE.getFormat(CE.DEFAULT_FORMAT_ID);
      if (!format) {
        flashLabel(label, "No format registered", previous);
        return;
      }

      if (label) label.textContent = "Exporting…";
      const payload = format.serialize(conversation);
      CE.downloadFile(
        `${CE.slugify(conversation.title)}.${format.extension}`,
        payload,
        format.mime
      );
      const modeTag = conversation.exportMode === "fast" ? "fast" : "slow";
      flashLabel(
        label,
        `Saved ${conversation.messages.length} (${modeTag})`,
        previous
      );
    } catch (error) {
      console.error("[Conversation Extractor] Export failed", error);
      flashLabel(label, "Export failed", previous);
    } finally {
      button.dataset.busy = "false";
    }
  }

  function flashLabel(label, message, restore) {
    if (!label) return;
    label.textContent = message;
    window.setTimeout(() => {
      label.textContent = restore || "Download Transcript";
    }, 1600);
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

