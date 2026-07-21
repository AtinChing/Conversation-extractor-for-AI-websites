(() => {
  "use strict";

  const BUTTON_ID = "ce-download-transcript";
  const STORAGE_DEFAULTS = {
    claudeThemeEnabled: false,
    exportFormat: "markdown"
  };

  const PLATFORM = detectPlatform();
  if (!PLATFORM) return;

  let exportFormat = STORAGE_DEFAULTS.exportFormat;
  let injectScheduled = false;

  init();

  function detectPlatform() {
    const host = location.hostname;
    if (host === "chatgpt.com" || host.endsWith(".chatgpt.com")) return "chatgpt";
    if (host === "claude.ai" || host.endsWith(".claude.ai")) return "claude";
    return null;
  }

  async function init() {
    const settings = await chrome.storage.local.get(STORAGE_DEFAULTS);
    exportFormat = settings.exportFormat === "json" ? "json" : "markdown";

    if (PLATFORM === "chatgpt") {
      applyClaudeTheme(Boolean(settings.claudeThemeEnabled));
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.exportFormat) {
        exportFormat = changes.exportFormat.newValue === "json" ? "json" : "markdown";
      }
      if (PLATFORM === "chatgpt" && changes.claudeThemeEnabled) {
        applyClaudeTheme(Boolean(changes.claudeThemeEnabled.newValue));
      }
    });

    ensureButton();
    observeDom();
  }

  function applyClaudeTheme(enabled) {
    document.documentElement.setAttribute("data-claudifier", enabled ? "on" : "off");
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
      const conversation = scrapeConversation();
      if (!conversation.messages.length) {
        flashLabel(label, "No messages found", previous);
        return;
      }

      const format = exportFormat === "json" ? "json" : "markdown";
      const payload =
        format === "json"
          ? JSON.stringify(buildJson(conversation), null, 2)
          : buildMarkdown(conversation);
      const extension = format === "json" ? "json" : "md";
      const mime = format === "json" ? "application/json" : "text/markdown";
      downloadFile(slugify(conversation.title) + "." + extension, payload, mime);
      flashLabel(label, "Downloaded", previous);
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

  function scrapeConversation() {
    const title = getConversationTitle();
    const messages =
      PLATFORM === "chatgpt" ? scrapeChatGPT() : scrapeClaude();

    return {
      platform: PLATFORM,
      title,
      url: location.href,
      exportedAt: new Date().toISOString(),
      messages
    };
  }

  function getConversationTitle() {
    const candidates = [
      document.querySelector("title")?.textContent,
      document.querySelector("h1")?.textContent,
      document.querySelector('[data-testid="conversation-title"]')?.textContent,
      document.querySelector('[data-testid="chat-title"]')?.textContent
    ];

    for (const raw of candidates) {
      const cleaned = cleanTitle(raw);
      if (cleaned) return cleaned;
    }
    return PLATFORM === "chatgpt" ? "ChatGPT Conversation" : "Claude Conversation";
  }

  function cleanTitle(raw) {
    if (!raw) return "";
    let title = String(raw).replace(/\s+/g, " ").trim();
    title = title
      .replace(/\s*[|–—-]\s*ChatGPT\s*$/i, "")
      .replace(/\s*[|–—-]\s*Claude\s*$/i, "")
      .replace(/\s*-\s*Claude\s*$/i, "")
      .trim();
    return title;
  }

  function scrapeChatGPT() {
    const turns = collectChatGPTTurns();
    const messages = [];

    for (const turn of turns) {
      const role = resolveChatGPTRole(turn);
      if (!role) continue;

      const contentRoot = findChatGPTContentRoot(turn, role);
      const content = serializeRichContent(contentRoot || turn);
      if (!content.trim()) continue;

      messages.push({ role, content: content.trim() });
    }

    return dedupeAdjacent(messages);
  }

  function collectChatGPTTurns() {
    const selectorSets = [
      'article[data-testid^="conversation-turn-"]',
      '[data-testid="conversation-turn"]',
      "[data-message-author-role]",
      "main article"
    ];

    for (const selector of selectorSets) {
      const nodes = dedupeElements([...document.querySelectorAll(selector)]).filter(
        (el) => isReadableCandidate(el)
      );
      if (!nodes.length) continue;

      const outermost = nodes.filter(
        (el) => !nodes.some((other) => other !== el && other.contains(el))
      );
      if (outermost.length) {
        return outermost.sort(byDocumentOrder);
      }
    }
    return [];
  }

  function resolveChatGPTRole(turn) {
    const attr =
      turn.getAttribute("data-message-author-role") ||
      turn.getAttribute("data-turn") ||
      turn.getAttribute("data-role") ||
      turn.getAttribute("data-message-author") ||
      "";

    if (/^user$/i.test(attr)) return "user";
    if (/^(assistant|ai|system)$/i.test(attr)) return "assistant";

    const nested = turn.querySelector(
      "[data-message-author-role], [data-turn], [data-role], [data-message-author]"
    );
    if (nested) {
      const nestedAttr =
        nested.getAttribute("data-message-author-role") ||
        nested.getAttribute("data-turn") ||
        nested.getAttribute("data-role") ||
        nested.getAttribute("data-message-author") ||
        "";
      if (/^user$/i.test(nestedAttr)) return "user";
      if (/^(assistant|ai|system)$/i.test(nestedAttr)) return "assistant";
    }

    if (turn.querySelector(".agent-turn")) return "assistant";
    if (turn.querySelector(".user-turn")) return "user";
    return null;
  }

  function findChatGPTContentRoot(turn, role) {
    const roleNode =
      turn.matches("[data-message-author-role]")
        ? turn
        : turn.querySelector(`[data-message-author-role="${role}"]`) || turn;

    const contentSelectors = [
      ".markdown",
      ".prose",
      '[class*="markdown"]',
      ".whitespace-pre-wrap",
      "[data-message-id]"
    ];

    for (const selector of contentSelectors) {
      const node = roleNode.querySelector(selector);
      if (node && node.textContent && node.textContent.trim()) return node;
    }
    return roleNode;
  }

  function scrapeClaude() {
    const nodes = collectClaudeMessages();
    const messages = [];

    for (const node of nodes) {
      const role = resolveClaudeRole(node);
      if (!role) continue;

      const clone = node.cloneNode(true);
      stripClaudeArtifacts(clone);
      const contentRoot = findClaudeContentRoot(clone) || clone;
      const content = serializeRichContent(contentRoot);
      if (!content.trim()) continue;
      messages.push({ role, content: content.trim() });
    }

    return dedupeAdjacent(messages);
  }

  function collectClaudeMessages() {
    const selector = [
      '[data-testid="user-message"]',
      '[data-testid="human-message"]',
      '[data-testid="message-human"]',
      ".font-user-message",
      ".\\!font-user-message",
      '[class*="font-user-message"]',
      ".font-claude-response",
      '[data-testid="ai-message"]',
      '[data-testid="message-assistant"]',
      ".font-claude-message",
      ".assistant-message"
    ].join(", ");

    const nodes = dedupeElements([...document.querySelectorAll(selector)]).filter(
      (el) => isReadableCandidate(el) && !isNoiseNode(el)
    );

    const outermost = nodes.filter(
      (el) => !nodes.some((other) => other !== el && other.contains(el))
    );

    if (outermost.length) return outermost.sort(byDocumentOrder);

    const groups = [...document.querySelectorAll("[data-test-render-count]")];
    return groups.filter((el) => isReadableCandidate(el)).sort(byDocumentOrder);
  }

  function resolveClaudeRole(node) {
    const userSelector = [
      '[data-testid="user-message"]',
      '[data-testid="human-message"]',
      '[data-testid="message-human"]',
      ".font-user-message",
      ".\\!font-user-message",
      '[class*="font-user-message"]'
    ].join(", ");

    const assistantSelector = [
      ".font-claude-response",
      '[data-testid="ai-message"]',
      '[data-testid="message-assistant"]',
      ".font-claude-message",
      ".assistant-message"
    ].join(", ");

    if (node.matches(userSelector)) return "user";
    if (node.matches(assistantSelector)) return "assistant";
    if (node.querySelector(userSelector)) return "user";
    if (node.querySelector(assistantSelector)) return "assistant";
    return null;
  }

  function findClaudeContentRoot(node) {
    const selectors = [
      ".standard-markdown",
      ".progressive-markdown",
      ".font-claude-response-body",
      ".markdown",
      ".prose",
      '[class*="markdown"]'
    ];
    for (const selector of selectors) {
      const found = node.querySelector(selector);
      if (found && found.textContent && found.textContent.trim()) return found;
    }
    return node;
  }

  function stripClaudeArtifacts(root) {
    const junkSelectors = [
      "button",
      '[data-testid="action-bar-copy"]',
      '[data-testid*="feedback"]',
      '[aria-label*="Copy"]',
      '[aria-label*="Good response"]',
      '[aria-label*="Bad response"]',
      '[aria-label*="Retry"]',
      '[aria-label*="Edit"]',
      '[class*="CopyButton"]',
      '[class*="feedback"]',
      "svg",
      "style",
      "script",
      "noscript"
    ];
    for (const selector of junkSelectors) {
      root.querySelectorAll(selector).forEach((el) => el.remove());
    }
  }

  function isNoiseNode(el) {
    if (el.closest("#" + BUTTON_ID)) return true;
    if (el.getAttribute("aria-hidden") === "true") return true;
    return false;
  }

  function isReadableCandidate(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.closest("#" + BUTTON_ID)) return false;
    const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    return text.length >= 1;
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

  function dedupeAdjacent(messages) {
    const result = [];
    for (const message of messages) {
      const prev = result[result.length - 1];
      if (prev && prev.role === message.role && prev.content === message.content) {
        continue;
      }
      result.push(message);
    }
    return result;
  }

  function dedupeElements(elements) {
    return [...new Set(elements)];
  }

  function byDocumentOrder(a, b) {
    if (a === b) return 0;
    const position = a.compareDocumentPosition(b);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  }

  function buildMarkdown(conversation) {
    const lines = [
      `# ${conversation.title}`,
      "",
      `- Platform: ${conversation.platform === "chatgpt" ? "ChatGPT" : "Claude"}`,
      `- URL: ${conversation.url}`,
      `- Exported: ${conversation.exportedAt}`,
      "",
      "---",
      ""
    ];

    conversation.messages.forEach((message, index) => {
      const heading = message.role === "user" ? "User" : "Assistant";
      lines.push(`## ${heading}`);
      lines.push("");
      lines.push(message.content);
      if (index < conversation.messages.length - 1) {
        lines.push("");
        lines.push("---");
        lines.push("");
      }
    });

    return lines.join("\n").trim() + "\n";
  }

  function buildJson(conversation) {
    return {
      title: conversation.title,
      platform: conversation.platform,
      url: conversation.url,
      exportedAt: conversation.exportedAt,
      messageCount: conversation.messages.length,
      messages: conversation.messages.map((message, index) => ({
        index: index + 1,
        role: message.role,
        content: message.content
      }))
    };
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function slugify(value) {
    const base = String(value || "conversation")
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    return base || "conversation";
  }
})();
