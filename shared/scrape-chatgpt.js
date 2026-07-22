(() => {
  "use strict";

  const CE = (globalThis.CE = globalThis.CE || {});

  /**
   * Full ChatGPT conversation capture (scrolls virtualized turns when needed).
   * @returns {Promise<Array<{role: "user"|"assistant", content: string}>>}
   */
  CE.scrapeChatGPTFull = async function scrapeChatGPTFull() {
    if (typeof CE.harvestByScrolling === "function") {
      return CE.harvestByScrolling({
        findScroller: findChatGPTScrollRoot,
        extractMounted: extractMountedMessages,
        keyFor: chatGPTMessageKey,
        fallback: () => CE._scrapeChatGPTMountedOnly()
      });
    }
    return CE._scrapeChatGPTMountedOnly();
  };

  CE._scrapeChatGPTMountedOnly = function scrapeChatGPTMountedOnly() {
    return CE.dedupeAdjacentMessages
      ? CE.dedupeAdjacentMessages(
          extractMountedMessages(document).map(({ role, content }) => ({
            role,
            content
          }))
        )
      : extractMountedMessages(document).map(({ role, content }) => ({
          role,
          content
        }));
  };

  function extractMountedMessages(root) {
    const scope = root instanceof Element || root instanceof Document ? root : document;
    const turns = collectChatGPTTurns(scope);
    const messages = [];

    for (const turn of turns) {
      const role = resolveChatGPTRole(turn);
      if (!role) continue;

      const contentRoot = findChatGPTContentRoot(turn, role);
      const content = serialize(contentRoot || turn);
      if (!content.trim()) continue;
      messages.push({ role, content: content.trim(), node: turn });
    }

    return messages;
  }

  function collectChatGPTTurns(root) {
    const selectorSets = [
      'article[data-testid^="conversation-turn-"]',
      '[data-testid="conversation-turn"]',
      "[data-message-author-role]",
      "main article"
    ];

    for (const selector of selectorSets) {
      const nodes = dedupeElements([...root.querySelectorAll(selector)]).filter(
        (el) => isReadableCandidate(el)
      );
      if (!nodes.length) continue;

      const outermost = nodes.filter(
        (el) => !nodes.some((other) => other !== el && other.contains(el))
      );
      if (outermost.length) return outermost.sort(byDocumentOrder);
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
    const roleNode = turn.matches("[data-message-author-role]")
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

  function findChatGPTScrollRoot() {
    const seeds = collectChatGPTTurns(document);
    return CE.findScrollRootNear(
      seeds,
      '[class*="react-scroll"], [class*="overflow-y-auto"], main'
    );
  }

  function chatGPTMessageKey(message) {
    const { role, content, node } = message;
    const idHost =
      node?.matches?.("[data-message-id]")
        ? node
        : node?.querySelector?.("[data-message-id]");
    const messageId = idHost?.getAttribute("data-message-id");
    if (messageId) return `${role}:id:${messageId}`;

    const turnId =
      node?.getAttribute?.("data-testid") ||
      node?.closest?.("[data-testid^='conversation-turn']")?.getAttribute("data-testid");
    if (turnId) return `${role}:turn:${turnId}`;

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
