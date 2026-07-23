(() => {
  "use strict";

  const CE = (globalThis.CE = globalThis.CE || {});

  const SOURCE_EXT = "ce-ext";
  const SOURCE_PAGE = "ce-page";
  let requestSeq = 0;
  /** @type {Map<number, {resolve: Function, reject: Function, timer: number}>} */
  const pending = new Map();

  const DEFAULT_TIMEOUT_MS = 45000;

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== SOURCE_PAGE || data.type !== "ce-response") return;
    if (event.source !== window) return;

    const waiter = pending.get(data.id);
    if (!waiter) return;
    pending.delete(data.id);
    window.clearTimeout(waiter.timer);

    if (data.ok) waiter.resolve(data.data);
    else waiter.reject(new Error(data.error || "Fast mode page request failed"));
  });

  /**
   * Call a MAIN-world handler registered via window.__CE_PAGE__.register.
   * @param {string} action
   * @param {object} [payload]
   * @param {number} [timeoutMs]
   */
  CE.pageRequest = function pageRequest(action, payload, timeoutMs) {
    const id = ++requestSeq;
    const timeout = timeoutMs || DEFAULT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Fast mode timed out waiting for: ${action}`));
      }, timeout);

      pending.set(id, { resolve, reject, timer });
      window.postMessage(
        {
          source: SOURCE_EXT,
          type: "ce-request",
          id,
          action,
          payload: payload || {}
        },
        "*"
      );
    });
  };

  /**
   * Fast path: ask the MAIN-world platform handler for the full conversation.
   * Throws on failure so callers can fall back to slow DOM scrape.
   * @param {"chatgpt"|"claude"|"gemini"} platform
   * @returns {Promise<Array<{role: "user"|"assistant", content: string}>>}
   */
  CE.scrapeFast = async function scrapeFast(platform) {
    const action = `${platform}.fetchConversation`;
    const result = await CE.pageRequest(action, {
      href: location.href,
      title: document.title || ""
    });

    const messages = Array.isArray(result?.messages) ? result.messages : [];
    const normalized = messages
      .map((message) => ({
        role: message?.role === "user" ? "user" : "assistant",
        content: String(message?.content || "").trim()
      }))
      .filter((message) => message.content);

    if (!normalized.length) {
      throw new Error(`Fast mode returned no messages for ${platform}`);
    }

    if (result?.title && typeof result.title === "string") {
      CE._fastTitleHint = result.title.trim();
    }

    return CE.dedupeAdjacentMessages
      ? CE.dedupeAdjacentMessages(normalized)
      : normalized;
  };
})();
