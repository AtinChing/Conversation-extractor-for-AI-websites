(() => {
  "use strict";

  const CE = globalThis.CE;
  if (!CE || typeof CE.registerFormat !== "function") {
    throw new Error("shared/formats/json.js: CE registry not loaded");
  }

  /**
   * Normalize role to the only allowed values: "user" | "assistant".
   * Unknown / missing roles default to "assistant".
   * @param {unknown} role
   * @returns {"user"|"assistant"}
   */
  function normalizeRole(role) {
    const value = String(role ?? "")
      .trim()
      .toLowerCase();
    return value === "user" ? "user" : "assistant";
  }

  /**
   * Build a schema-stable export payload from a conversation.
   * Keys and nesting are fixed for downstream consumers.
   * @param {import('../namespace.js').CEConversation | null | undefined} conversation
   */
  function toExportPayload(conversation) {
    const source = conversation && typeof conversation === "object" ? conversation : {};
    const rawMessages = Array.isArray(source.messages) ? source.messages : [];

    const messages = rawMessages.map((message, index) => {
      const entry = message && typeof message === "object" ? message : {};
      return {
        index: index + 1,
        role: normalizeRole(entry.role),
        content: String(entry.content ?? "")
      };
    });

    return {
      title: String(source.title || "Conversation"),
      platform: String(source.platform || "unknown"),
      url: String(source.url || ""),
      exportedAt: String(source.exportedAt || new Date().toISOString()),
      messageCount: messages.length,
      messages
    };
  }

  // OWNER: format-json agent — implement serialize() only in this file.
  // Must emit pretty-printed, schema-stable JSON (2-space indent).
  CE.registerFormat({
    id: "json",
    label: "JSON",
    extension: "json",
    mime: "application/json",
    serialize(conversation) {
      return `${JSON.stringify(toExportPayload(conversation), null, 2)}\n`;
    }
  });
})();
