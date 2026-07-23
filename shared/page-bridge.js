(() => {
  "use strict";

  /**
   * MAIN-world bridge. Platform fast scrapers register handlers here.
   * Isolated content scripts talk via window.postMessage.
   */
  const SOURCE_EXT = "ce-ext";
  const SOURCE_PAGE = "ce-page";

  const handlers = new Map();

  const api = {
    register(action, handler) {
      if (!action || typeof handler !== "function") {
        throw new Error("__CE_PAGE__.register(action, handler) required");
      }
      handlers.set(action, handler);
    },
    has(action) {
      return handlers.has(action);
    }
  };

  window.__CE_PAGE__ = api;

  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (!data || data.source !== SOURCE_EXT || data.type !== "ce-request") return;
    if (event.source !== window) return;

    const { id, action, payload } = data;
    const handler = handlers.get(action);
    if (!handler) {
      window.postMessage(
        {
          source: SOURCE_PAGE,
          type: "ce-response",
          id,
          ok: false,
          error: `No MAIN handler registered for action: ${action}`
        },
        "*"
      );
      return;
    }

    try {
      const result = await handler(payload || {});
      window.postMessage(
        {
          source: SOURCE_PAGE,
          type: "ce-response",
          id,
          ok: true,
          data: result
        },
        "*"
      );
    } catch (error) {
      window.postMessage(
        {
          source: SOURCE_PAGE,
          type: "ce-response",
          id,
          ok: false,
          error: error && error.message ? error.message : String(error)
        },
        "*"
      );
    }
  });
})();
