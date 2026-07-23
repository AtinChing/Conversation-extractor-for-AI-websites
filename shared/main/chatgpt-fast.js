(() => {
  "use strict";

  /**
   * OWNER: chatgpt-fast agent
   * Register ChatGPT internal conversation fetch for Fast Mode.
   */
  function ready(fn) {
    if (window.__CE_PAGE__ && typeof window.__CE_PAGE__.register === "function") {
      fn(window.__CE_PAGE__);
      return;
    }
    const timer = window.setInterval(() => {
      if (window.__CE_PAGE__ && typeof window.__CE_PAGE__.register === "function") {
        window.clearInterval(timer);
        fn(window.__CE_PAGE__);
      }
    }, 20);
    window.setTimeout(() => window.clearInterval(timer), 10000);
  }

  const CONVERSATION_ID_RE =
    /\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

  function parseConversationId(href) {
    const source = href || location.href;
    let pathname = location.pathname;
    try {
      pathname = new URL(source, location.origin).pathname;
    } catch {
      /* use location.pathname */
    }
    const match = pathname.match(CONVERSATION_ID_RE);
    return match ? match[1] : null;
  }

  async function fetchAccessToken() {
    const response = await fetch("/api/auth/session", {
      method: "GET",
      credentials: "include",
      headers: { accept: "application/json" }
    });

    if (!response.ok) {
      throw new Error(`ChatGPT session auth failed (HTTP ${response.status})`);
    }

    let session;
    try {
      session = await response.json();
    } catch {
      throw new Error("ChatGPT session auth failed (invalid JSON response)");
    }

    const token = session && typeof session.accessToken === "string" ? session.accessToken.trim() : "";
    if (!token) {
      throw new Error("ChatGPT session auth failed (no access token)");
    }

    return token;
  }

  async function fetchConversation(conversationId, accessToken) {
    const response = await fetch(`/backend-api/conversation/${conversationId}`, {
      method: "GET",
      credentials: "include",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`ChatGPT conversation fetch failed (HTTP ${response.status})`);
    }

    try {
      return await response.json();
    } catch {
      throw new Error("ChatGPT conversation fetch failed (invalid JSON response)");
    }
  }

  function resolveRole(message) {
    const role = message?.author?.role || message?.role;
    return role === "user" || role === "assistant" ? role : null;
  }

  function flattenParts(parts) {
    if (!Array.isArray(parts)) return "";
    const chunks = [];

    for (const part of parts) {
      if (typeof part === "string") {
        if (part.trim()) chunks.push(part);
        continue;
      }
      if (!part || typeof part !== "object") continue;

      if (typeof part.text === "string" && part.text.trim()) {
        chunks.push(part.text);
        continue;
      }
      if (typeof part.content === "string" && part.content.trim()) {
        chunks.push(part.content);
      }
    }

    return chunks.join("\n").trim();
  }

  function extractMessageContent(message) {
    const content = message?.content;
    if (!content || typeof content !== "object") return "";

    const contentType = content.content_type || "text";

    if (contentType === "text" || contentType === "multimodal_text") {
      return flattenParts(content.parts);
    }

    if (contentType === "code" && typeof content.text === "string") {
      return content.text.trim();
    }

    if (Array.isArray(content.parts)) {
      return flattenParts(content.parts);
    }

    if (typeof content.text === "string") {
      return content.text.trim();
    }

    return "";
  }

  function findCurrentNodeFallback(mapping) {
    let bestId = null;
    let bestWeight = -Infinity;
    let bestTime = -Infinity;

    for (const [id, node] of Object.entries(mapping)) {
      if (!node || typeof node !== "object") continue;
      const children = node.children;
      if (Array.isArray(children) && children.length > 0) continue;

      const message = node.message;
      const weight = typeof message?.weight === "number" ? message.weight : 1;
      const createTime =
        typeof message?.create_time === "number" ? message.create_time : 0;

      if (weight > bestWeight || (weight === bestWeight && createTime > bestTime)) {
        bestWeight = weight;
        bestTime = createTime;
        bestId = id;
      }
    }

    return bestId;
  }

  function buildActivePath(mapping, currentNodeId) {
    if (!mapping || typeof mapping !== "object") return [];

    let nodeId =
      typeof currentNodeId === "string" && mapping[currentNodeId]
        ? currentNodeId
        : findCurrentNodeFallback(mapping);

    if (!nodeId) return [];

    const path = [];
    const seen = new Set();

    while (nodeId && mapping[nodeId]) {
      if (seen.has(nodeId)) break;
      seen.add(nodeId);
      path.push(mapping[nodeId]);
      nodeId = mapping[nodeId].parent;
    }

    return path.reverse();
  }

  function mappingToMessages(mapping, currentNodeId) {
    const path = buildActivePath(mapping, currentNodeId);
    if (!path.length) {
      throw new Error("ChatGPT conversation has no message mapping");
    }

    const messages = [];

    for (const node of path) {
      const message = node?.message;
      if (!message) continue;

      const role = resolveRole(message);
      if (!role) continue;

      const content = extractMessageContent(message);
      if (!content) continue;

      messages.push({ role, content });
    }

    if (!messages.length) {
      throw new Error("ChatGPT conversation produced no user/assistant messages");
    }

    return messages;
  }

  ready((page) => {
    page.register("chatgpt.fetchConversation", async (payload) => {
      const conversationId = parseConversationId(payload?.href);
      if (!conversationId) {
        throw new Error("Not on a ChatGPT conversation page (no conversation id in URL)");
      }

      const accessToken = await fetchAccessToken();
      const conversation = await fetchConversation(conversationId, accessToken);

      const mapping = conversation?.mapping;
      if (!mapping || typeof mapping !== "object" || !Object.keys(mapping).length) {
        throw new Error("ChatGPT conversation has no message mapping");
      }

      const messages = mappingToMessages(mapping, conversation.current_node);
      const title =
        typeof conversation?.title === "string" ? conversation.title.trim() : undefined;

      return {
        ...(title ? { title } : {}),
        messages
      };
    });
  });
})();
