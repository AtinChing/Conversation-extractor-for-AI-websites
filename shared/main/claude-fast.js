(() => {
  "use strict";

  /**
   * OWNER: claude-fast agent
   * Register Claude internal conversation fetch for Fast Mode.
   */
  const UUID_RE = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;

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

  function parseConversationId(href) {
    const url = String(href || location.href || "");
    const pathMatch = url.match(/\/chat\/([a-f0-9-]{36})/i);
    if (pathMatch) return pathMatch[1].toLowerCase();
    const uuidMatch = url.match(UUID_RE);
    return uuidMatch ? uuidMatch[0].toLowerCase() : null;
  }

  function readCookie(name) {
    const prefix = `${name}=`;
    for (const part of document.cookie.split(";")) {
      const trimmed = part.trim();
      if (trimmed.startsWith(prefix)) {
        return decodeURIComponent(trimmed.slice(prefix.length));
      }
    }
    return null;
  }

  async function apiGet(path) {
    let response;
    try {
      response = await fetch(path, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" }
      });
    } catch (error) {
      throw new Error(`Claude API request failed for ${path}: ${error?.message || error}`);
    }

    if (!response.ok) {
      throw new Error(`Claude API ${path} failed: ${response.status} ${response.statusText}`);
    }

    try {
      return await response.json();
    } catch (error) {
      throw new Error(`Claude API ${path} returned invalid JSON: ${error?.message || error}`);
    }
  }

  async function apiGetOptional(path) {
    let response;
    try {
      response = await fetch(path, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" }
      });
    } catch (error) {
      throw new Error(`Claude API request failed for ${path}: ${error?.message || error}`);
    }

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Claude API ${path} failed: ${response.status} ${response.statusText}`);
    }

    try {
      return await response.json();
    } catch (error) {
      throw new Error(`Claude API ${path} returned invalid JSON: ${error?.message || error}`);
    }
  }

  function orgUuidsFromResponse(data) {
    const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    return rows.map((row) => row?.uuid || row?.id).filter(Boolean);
  }

  async function listOrganizationUuids() {
    const data = await apiGet("/api/organizations");
    const orgs = orgUuidsFromResponse(data);
    if (!orgs.length) {
      throw new Error("Claude API returned no organizations (are you logged in?)");
    }
    return orgs;
  }

  function conversationFetchPath(orgUuid, convUuid) {
    const qs = new URLSearchParams({
      tree: "True",
      rendering_mode: "messages",
      render_all_tools: "true"
    });
    return `/api/organizations/${encodeURIComponent(orgUuid)}/chat_conversations/${encodeURIComponent(convUuid)}?${qs}`;
  }

  async function fetchConversation(convUuid) {
    const orgs = await listOrganizationUuids();
    const preferred = readCookie("lastActiveOrg");
    const ordered =
      preferred && orgs.includes(preferred)
        ? [preferred, ...orgs.filter((org) => org !== preferred)]
        : orgs.slice();

    for (const orgUuid of ordered) {
      const data = await apiGetOptional(conversationFetchPath(orgUuid, convUuid));
      if (data && (Array.isArray(data.chat_messages) || data.uuid)) {
        return data;
      }
    }

    throw new Error(`Claude conversation not found: ${convUuid}`);
  }

  function flattenChatMessages(node) {
    if (!node) return [];
    if (Array.isArray(node)) return node.flatMap(flattenChatMessages);
    if (node.uuid || node.sender) return [node];
    if (Array.isArray(node.children)) return node.children.flatMap(flattenChatMessages);
    return [];
  }

  function selectActiveLineage(data) {
    const all = flattenChatMessages(data?.chat_messages);
    const leafId = data?.current_leaf_message_uuid;
    if (!leafId) return all;

    const byUuid = new Map();
    for (const message of all) {
      if (message?.uuid) byUuid.set(message.uuid, message);
    }
    if (!byUuid.has(leafId)) return all;

    const reversed = [];
    const visited = new Set();
    let current = leafId;
    while (current && byUuid.has(current) && !visited.has(current)) {
      visited.add(current);
      reversed.push(byUuid.get(current));
      current = byUuid.get(current)?.parent_message_uuid || null;
    }
    return reversed.reverse();
  }

  function blocksFromContent(content) {
    if (!content) return [];
    if (typeof content === "string") return [{ type: "text", text: content }];
    if (Array.isArray(content)) return content;
    return [];
  }

  function textFromBlock(block) {
    if (!block) return "";
    if (typeof block === "string") return block.trim();
    if (typeof block !== "object") return "";

    if (block.type === "text" && typeof block.text === "string") {
      return block.text.trim();
    }
    if (typeof block.text === "string") {
      return block.text.trim();
    }
    if (Array.isArray(block.content)) {
      return block.content
        .map((part) => textFromBlock(part))
        .filter(Boolean)
        .join("\n")
        .trim();
    }
    return "";
  }

  function extractHumanContent(message) {
    const parts = [];

    for (const attachment of message?.attachments || []) {
      const extracted = String(attachment?.extracted_content || "").trim();
      if (extracted) parts.push(extracted);
    }

    for (const block of blocksFromContent(message?.content)) {
      const text = textFromBlock(block);
      if (text) parts.push(text);
    }

    if (!parts.length) {
      const fallback = String(message?.text || "").trim();
      if (fallback) parts.push(fallback);
    }

    return parts.join("\n\n").trim();
  }

  function extractAssistantContent(message) {
    const parts = [];

    for (const block of blocksFromContent(message?.content)) {
      if (block?.type && block.type !== "text") continue;
      const text = textFromBlock(block);
      if (text) parts.push(text);
    }

    if (!parts.length) {
      const fallback = String(message?.text || "").trim();
      if (fallback) parts.push(fallback);
    }

    return parts.join("\n\n").trim();
  }

  function normalizeMessages(rawMessages) {
    const messages = [];
    for (const message of rawMessages || []) {
      if (message?.sender === "human") {
        const content = extractHumanContent(message);
        if (content) messages.push({ role: "user", content });
        continue;
      }
      if (message?.sender === "assistant") {
        const content = extractAssistantContent(message);
        if (content) messages.push({ role: "assistant", content });
      }
    }
    return messages;
  }

  function cleanTitle(raw) {
    if (!raw) return undefined;
    let title = String(raw).replace(/\s+/g, " ").trim();
    title = title
      .replace(/\s*Last message[\s\u00a0]+\d+[\s\u00a0]*\w+[\s\u00a0]*ago[\s\u00a0]*\^archived\s*$/i, "")
      .replace(/\^archived\s*$/i, "")
      .trim();
    return title || undefined;
  }

  ready((page) => {
    page.register("claude.fetchConversation", async (payload) => {
      const convUuid = parseConversationId(payload?.href);
      if (!convUuid) {
        throw new Error("Could not parse Claude conversation id from URL");
      }

      const data = await fetchConversation(convUuid);
      const lineage = selectActiveLineage(data);
      const messages = normalizeMessages(lineage);

      if (!messages.length) {
        throw new Error("Claude fast mode: conversation has no readable messages");
      }

      return {
        title: cleanTitle(data?.name) || undefined,
        messages
      };
    });
  });
})();
