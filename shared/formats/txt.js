(() => {
  "use strict";

  const CE = globalThis.CE;
  if (!CE || typeof CE.registerFormat !== "function") {
    throw new Error("shared/formats/txt.js: CE registry not loaded");
  }

  function platformLabel(platform) {
    if (platform === "chatgpt") return "ChatGPT";
    if (platform === "claude") return "Claude";
    if (platform === "gemini") return "Gemini";
    return String(platform || "Unknown");
  }

  function roleLabel(role) {
    return role === "user" ? "USER" : "ASSISTANT";
  }

  /**
   * Lightly flatten Markdown-ish artifacts so plain-text reads cleanly
   * without rewriting the message substance.
   */
  function flattenMarkdown(text) {
    let s = String(text || "");

    // Fenced code blocks → keep body, drop ```lang fences
    s = s.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) => {
      const body = String(code || "").replace(/\s+$/g, "");
      return body ? `\n${body}\n` : "\n";
    });

    // Headings: "# Title" → "Title"
    s = s.replace(/^#{1,6}\s+/gm, "");

    // Images: ![alt](url) → alt (or url)
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
      return String(alt || "").trim() || String(url || "").trim();
    });

    // Links: [label](url) → label (url) when distinct; else label
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const a = String(label || "").trim();
      const u = String(url || "").trim();
      if (!a) return u;
      if (!u || a === u) return a;
      return `${a} (${u})`;
    });

    // Bold / italic / strikethrough markers
    s = s.replace(/(\*\*|__)(.*?)\1/g, "$2");
    s = s.replace(/(\*|_)(.*?)\1/g, "$2");
    s = s.replace(/~~(.*?)~~/g, "$1");

    // Inline code backticks
    s = s.replace(/`([^`]+)`/g, "$1");

    // Blockquotes: "> quote" → "quote"
    s = s.replace(/^>\s?/gm, "");

    // Horizontal rules
    s = s.replace(/^\s*([-*_]){3,}\s*$/gm, "");

    // Collapse runs of blank lines
    s = s.replace(/\n{3,}/g, "\n\n");

    return s.trim();
  }

  function tidyBlankLines(text) {
    return String(text || "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // OWNER: format-txt agent — implement serialize() only in this file.
  CE.registerFormat({
    id: "txt",
    label: "Plain Text",
    extension: "txt",
    mime: "text/plain",
    serialize(conversation) {
      const title = conversation?.title || "Conversation";
      const platform = platformLabel(conversation?.platform);
      const url = conversation?.url || "";
      const exportedAt = conversation?.exportedAt || "";

      const parts = [
        title,
        "=".repeat(Math.min(Math.max(title.length, 12), 72)),
        `Platform: ${platform}`,
        `URL: ${url}`,
        `Exported: ${exportedAt}`,
        "",
        "-----"
      ];

      const messages = Array.isArray(conversation?.messages)
        ? conversation.messages
        : [];

      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        const label = roleLabel(message?.role);
        const content = flattenMarkdown(message?.content);

        parts.push("", label, "-".repeat(label.length), content);

        if (i < messages.length - 1) {
          parts.push("", "-----");
        }
      }

      return `${tidyBlankLines(parts.join("\n"))}\n`;
    }
  });
})();
