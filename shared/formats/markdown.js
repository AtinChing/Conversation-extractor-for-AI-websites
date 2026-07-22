(() => {
  "use strict";

  const CE = globalThis.CE;
  if (!CE || typeof CE.registerFormat !== "function") {
    throw new Error("shared/formats/markdown.js: CE registry not loaded");
  }

  const PLATFORM_LABELS = {
    chatgpt: "ChatGPT",
    claude: "Claude",
    gemini: "Gemini"
  };

  const ROLE_HEADINGS = {
    user: "User",
    assistant: "Assistant"
  };

  function platformLabel(platform) {
    if (platform && PLATFORM_LABELS[platform]) return PLATFORM_LABELS[platform];
    return platform ? String(platform) : "Unknown";
  }

  function roleHeading(role) {
    return ROLE_HEADINGS[role] || "Assistant";
  }

  /**
   * Collapse 3+ consecutive newlines to a single blank line.
   * Leaves scraper-normalized markdown (fences, lists, headings) intact.
   */
  function normalizeBlankLines(text) {
    return text.replace(/\n{3,}/g, "\n\n");
  }

  CE.registerFormat({
    id: "markdown",
    label: "Markdown",
    extension: "md",
    mime: "text/markdown",
    serialize(conversation) {
      const title = conversation?.title || "Conversation";
      const messages = Array.isArray(conversation?.messages)
        ? conversation.messages
        : [];

      const parts = [
        `# ${title}`,
        "",
        `- Platform: ${platformLabel(conversation?.platform)}`,
        `- URL: ${conversation?.url || ""}`,
        `- Exported: ${conversation?.exportedAt || ""}`,
        "",
        "---"
      ];

      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        // Content is already markdown-normalized by the scraper — emit as-is.
        const content = String(message?.content ?? "");

        parts.push("", `## ${roleHeading(message?.role)}`, "", content);

        if (i < messages.length - 1) {
          parts.push("", "---");
        }
      }

      return `${normalizeBlankLines(parts.join("\n")).trim()}\n`;
    }
  });
})();
