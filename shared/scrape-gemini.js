(() => {
  "use strict";

  const CE = (globalThis.CE = globalThis.CE || {});

  const MESSAGE_SELECTOR = [
    "user-query",
    "model-response",
    '[data-test-id="user-query"]',
    '[data-test-id="model-response"]',
    ".user-query",
    ".model-response"
  ].join(", ");

  /**
   * Full Gemini conversation capture. Scrolls to load lazy history, skips
   * nested "thinking" panels when extracting assistant text.
   * @returns {Promise<Array<{role: "user"|"assistant", content: string}>>}
   */
  CE.scrapeGeminiFull = async function scrapeGeminiFull() {
    if (typeof CE.harvestByScrolling === "function") {
      return CE.harvestByScrolling({
        findScroller: findGeminiScrollRoot,
        extractMounted: extractMountedMessages,
        keyFor: geminiMessageKey,
        fallback: () => CE._scrapeGeminiMountedOnly(),
        settleMs: 220
      });
    }
    return CE._scrapeGeminiMountedOnly();
  };

  CE._scrapeGeminiMountedOnly = function scrapeGeminiMountedOnly() {
    const messages = extractMountedMessages(document).map(({ role, content }) => ({
      role,
      content
    }));
    return CE.dedupeAdjacentMessages
      ? CE.dedupeAdjacentMessages(messages)
      : messages;
  };

  function extractMountedMessages(root) {
    const scope = root instanceof Element || root instanceof Document ? root : document;
    const nodes = dedupeElements([...scope.querySelectorAll(MESSAGE_SELECTOR)])
      .filter((el) => isReadableCandidate(el))
      .filter((el) => !isInsideThoughts(el));

    const outermost = nodes.filter(
      (el) => !nodes.some((other) => other !== el && other.contains(el))
    );

    const messages = [];
    for (const node of outermost.sort(byDocumentOrder)) {
      const role = resolveGeminiRole(node);
      if (!role) continue;

      const clone = node.cloneNode(true);
      stripGeminiArtifacts(clone);
      const contentRoot = findGeminiContentRoot(clone, role) || clone;
      const content = serialize(contentRoot);
      if (!content.trim()) continue;
      messages.push({ role, content: content.trim(), node });
    }
    return messages;
  }

  function resolveGeminiRole(node) {
    const tag = node.tagName ? node.tagName.toLowerCase() : "";
    if (tag === "user-query" || node.matches?.('[data-test-id="user-query"], .user-query')) {
      return "user";
    }
    if (
      tag === "model-response" ||
      node.matches?.('[data-test-id="model-response"], .model-response')
    ) {
      return "assistant";
    }
    if (node.querySelector?.("user-query, [data-test-id='user-query'], .user-query")) {
      return "user";
    }
    if (
      node.querySelector?.(
        "model-response, [data-test-id='model-response'], .model-response"
      )
    ) {
      return "assistant";
    }
    return null;
  }

  function findGeminiContentRoot(node, role) {
    if (role === "user") {
      const userSelectors = [
        ".query-text",
        ".query-text-line",
        ".user-query-bubble-with-background",
        '[class*="query-text"]'
      ];
      for (const selector of userSelectors) {
        const found = queryOutsideThoughts(node, selector);
        if (found && found.textContent?.trim()) return found;
      }
      return node;
    }

    const assistantSelectors = [
      "message-content",
      ".markdown-main-panel",
      ".model-response-text",
      ".markdown",
      '[class*="markdown"]'
    ];
    for (const selector of assistantSelectors) {
      const found = queryOutsideThoughts(node, selector);
      if (found && found.textContent?.trim()) return found;
    }
    return node;
  }

  function queryOutsideThoughts(root, selector) {
    const matches = [...root.querySelectorAll(selector)];
    return matches.find((el) => !isInsideThoughts(el)) || null;
  }

  function isInsideThoughts(el) {
    return !!(
      el.closest &&
      el.closest(
        "model-thoughts, .model-thoughts, .thoughts-container, [data-test-id*='thought'], [class*='thoughts']"
      )
    );
  }

  function stripGeminiArtifacts(root) {
    root
      .querySelectorAll(
        "button, [role='button'], svg, style, script, noscript, model-thoughts, .model-thoughts, .thoughts-container, [data-test-id*='feedback'], [aria-label*='Copy'], [aria-label*='Good response'], [aria-label*='Bad response'], [aria-label*='Edit'], [aria-label*='Share'], [aria-label*='More']"
      )
      .forEach((el) => el.remove());
  }

  function findGeminiScrollRoot() {
    const seeds = [...document.querySelectorAll(MESSAGE_SELECTOR)];
    const explicit = document.querySelector(
      'infinite-scroller, [data-scroll-container="true"], #chat-history, .chat-history, .chat-history-scroll-container, [role="main"]'
    );
    if (explicit instanceof HTMLElement) {
      const nested = CE.findScrollRootNear(
        seeds.length ? seeds : [explicit],
        "infinite-scroller, [class*='overflow'], [role='main']"
      );
      if (nested) return nested;
      if (explicit.scrollHeight > explicit.clientHeight + 8) return explicit;
    }
    return CE.findScrollRootNear(
      seeds,
      "infinite-scroller, [data-scroll-container='true'], [class*='overflow-y'], main, [role='main']"
    );
  }

  function geminiMessageKey(message) {
    const { role, content, node } = message;
    const id =
      node?.id ||
      node?.getAttribute?.("data-message-id") ||
      node?.getAttribute?.("data-turn-id");
    if (id) return `${role}:id:${id}`;
    return `${role}:${CE.fingerprintContent(content)}`;
  }

  function serialize(node) {
    if (CE.serializeRichContent) return CE.serializeRichContent(node);
    return (node.innerText || node.textContent || "").trim();
  }

  function isReadableCandidate(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.closest("#ce-download-transcript")) return false;
    const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    return text.length >= 1;
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
})();
