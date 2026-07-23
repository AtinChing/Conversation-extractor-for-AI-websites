(() => {
  "use strict";

  /**
   * OWNER: gemini-fast agent
   * Register Gemini internal conversation fetch for Fast Mode.
   */
  const RPC_READ_CHAT = "hNvQHb";
  const BATCH_EXECUTE_PATH = "/_/BardChatUi/data/batchexecute";
  const ORIGIN = "https://gemini.google.com";
  const CONVERSATION_URL =
    /^https?:\/\/gemini\.google\.com\/(?:u\/\d+\/)?app\/([a-zA-Z0-9_-]+)/i;
  const PATH_PREFIX_RE = /^https?:\/\/gemini\.google\.com\/(u\/\d+)\//i;
  const GEMINI_IMAGE_URL_PATTERN =
    /^https:\/\/lh3\.googleusercontent\.com\/gg(?:-dl)?\//;

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

  function normalizeText(content) {
    return String(content)
      .replace(/\r\n/g, "\n")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function isLikelyMessageText(content) {
    const text = normalizeText(content);
    if (!text) return false;
    if (text.startsWith("http://") || text.startsWith("https://")) return false;
    if (text.includes("googleusercontent.com/image_generation_content/")) return false;
    if (/^(?:rc_|r_|c_)[a-zA-Z0-9_]+$/.test(text)) return false;
    if (/^[A-Za-z0-9+/=_-]{48,}$/.test(text)) return false;
    return /[A-Za-z0-9\u0080-\uFFFF]/.test(text);
  }

  function extractWithPatterns(source, patterns) {
    for (const pattern of patterns) {
      const match = pattern.exec(source);
      const value = match?.[1]?.trim();
      if (value) return value;
    }
    return undefined;
  }

  function extractConversationId(href) {
    const match = CONVERSATION_URL.exec(href || location.href);
    return match?.[1] || null;
  }

  function extractPathPrefix(href) {
    const match = PATH_PREFIX_RE.exec(href || location.href);
    return match ? `/${match[1]}` : "";
  }

  function getPreferredLanguage() {
    const docLang = document.documentElement?.lang?.trim();
    if (docLang) return docLang.split("-")[0];
    const navLang =
      typeof navigator !== "undefined" && navigator.language
        ? navigator.language.split("-")[0]
        : "";
    return navLang || "en";
  }

  function resolveRuntimeParams() {
    const wiz = window.WIZ_global_data;
    const fromWiz = {
      at: wiz && typeof wiz.SNlM0e === "string" ? wiz.SNlM0e.trim() : "",
      bl: wiz && typeof wiz.cfb2h === "string" ? wiz.cfb2h.trim() : "",
      fSid: wiz && typeof wiz.FdrFJe === "string" ? wiz.FdrFJe.trim() : ""
    };

    const html = document.documentElement ? document.documentElement.outerHTML : "";
    const fromHtml = {
      at:
        fromWiz.at ||
        extractWithPatterns(html, [
          /"SNlM0e":"([^"]+)"/,
          /\\"SNlM0e\\"\s*:\s*\\"([^"]+)\\"/
        ]) ||
        "",
      bl:
        fromWiz.bl ||
        extractWithPatterns(html, [
          /"cfb2h":"([^"]+)"/,
          /\\"cfb2h\\"\s*:\s*\\"([^"]+)\\"/
        ]) ||
        "",
      fSid:
        fromWiz.fSid ||
        extractWithPatterns(html, [
          /"FdrFJe":"([^"]+)"/,
          /\\"FdrFJe\\"\s*:\s*\\"([^"]+)\\"/
        ]) ||
        ""
    };

    const missing = [];
    if (!fromHtml.at) missing.push("SNlM0e");
    if (!fromHtml.bl) missing.push("cfb2h");
    if (!fromHtml.fSid) missing.push("FdrFJe");

    if (missing.length) {
      throw new Error(
        `Gemini fast mode: missing page tokens (${missing.join(", ")}). Reload the conversation and try again.`
      );
    }

    return {
      at: fromHtml.at,
      bl: fromHtml.bl,
      fSid: fromHtml.fSid,
      hl: getPreferredLanguage()
    };
  }

  function findRpcPayload(node, rpcId) {
    if (!Array.isArray(node)) return null;

    if (
      node.length >= 3 &&
      node[0] === "wrb.fr" &&
      node[1] === rpcId &&
      typeof node[2] === "string"
    ) {
      return node[2];
    }

    for (const child of node) {
      const payload = findRpcPayload(child, rpcId);
      if (payload) return payload;
    }

    return null;
  }

  function extractPayloadFromResponse(responseText, rpcId) {
    const lines = String(responseText).split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === ")]}'") continue;

      try {
        const parsed = JSON.parse(trimmed);
        const payload = findRpcPayload(parsed, rpcId);
        if (payload) return payload;
      } catch {
        // Ignore non-JSON lines in the chunked framing.
      }
    }

    return null;
  }

  async function fetchConversationPayload(conversationId, runtimeParams, pathPrefix) {
    const rpcId = RPC_READ_CHAT;
    const cid = conversationId.startsWith("c_") ? conversationId : `c_${conversationId}`;

    const query = new URLSearchParams({
      rpcids: rpcId,
      "source-path": `${pathPrefix}/app/${conversationId}`,
      bl: runtimeParams.bl,
      "f.sid": runtimeParams.fSid,
      hl: runtimeParams.hl,
      _reqid: String(1_000_000 + Math.floor(Math.random() * 9_000_000)),
      rt: "c"
    });

    const innerPayload = JSON.stringify([cid, 10000, null, 1, [0], [4], null, 1]);
    const fReq = JSON.stringify([
      [[rpcId, innerPayload, null, "generic"]]
    ]);
    const body = new URLSearchParams({ "f.req": fReq, at: runtimeParams.at });

    const endpoint = `${ORIGIN}${pathPrefix}${BATCH_EXECUTE_PATH}`;
    const response = await fetch(`${endpoint}?${query.toString()}`, {
      method: "POST",
      mode: "cors",
      credentials: "include",
      cache: "no-store",
      referrer: `${ORIGIN}${pathPrefix}/app/${conversationId}`,
      referrerPolicy: "strict-origin-when-cross-origin",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        Origin: ORIGIN,
        "X-Same-Domain": "1"
      },
      body: body.toString()
    });

    if (!response.ok) {
      throw new Error(`Gemini fast mode: batchexecute HTTP ${response.status}`);
    }

    const responseText = await response.text();
    const payloadString = extractPayloadFromResponse(responseText, rpcId);
    if (!payloadString) {
      throw new Error("Gemini fast mode: batchexecute response missing hNvQHb payload");
    }

    try {
      return JSON.parse(payloadString);
    } catch {
      throw new Error("Gemini fast mode: batchexecute payload is not valid JSON");
    }
  }

  function findAllStrings(root) {
    const out = [];
    const stack = [root];

    while (stack.length) {
      const current = stack.pop();
      if (typeof current === "string") {
        out.push(current);
        continue;
      }
      if (Array.isArray(current)) {
        for (let i = current.length - 1; i >= 0; i -= 1) stack.push(current[i]);
        continue;
      }
      if (current && typeof current === "object") {
        const values = Object.values(current);
        for (let i = values.length - 1; i >= 0; i -= 1) stack.push(values[i]);
      }
    }

    return out;
  }

  function extractGeminiImageUrls(node) {
    const seen = new Set();
    const urls = [];
    for (const value of findAllStrings(node)) {
      const url = value.trim();
      if (!GEMINI_IMAGE_URL_PATTERN.test(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
    return urls;
  }

  function findFirstString(node, skipThoughts) {
    const stack = [node];

    while (stack.length) {
      const current = stack.pop();
      if (typeof current === "string") {
        if (isLikelyMessageText(current)) return normalizeText(current);
        continue;
      }
      if (Array.isArray(current)) {
        const start = skipThoughts ? current.length - 1 : 0;
        const end = skipThoughts ? -1 : current.length;
        const step = skipThoughts ? -1 : 1;
        for (let i = start; i !== end; i += step) {
          if (skipThoughts && i === 37) continue;
          stack.push(current[i]);
        }
        continue;
      }
      if (current && typeof current === "object") {
        const values = Object.values(current);
        for (let i = values.length - 1; i >= 0; i -= 1) stack.push(values[i]);
      }
    }

    return null;
  }

  function extractUserFromTurn(turn) {
    if (!Array.isArray(turn) || turn.length < 3) return null;
    const section = turn[2];
    if (!Array.isArray(section)) return null;

    const promptArr = section[0];
    if (Array.isArray(promptArr) && typeof promptArr[0] === "string") {
      const text = normalizeText(promptArr[0]);
      return isLikelyMessageText(text) ? text : null;
    }

    const fallback = findFirstString(section, false);
    return fallback && isLikelyMessageText(fallback) ? fallback : null;
  }

  function extractAssistantFromTurn(turn) {
    if (!Array.isArray(turn) || turn.length < 4) return null;
    const section = turn[3];
    if (!Array.isArray(section)) return null;

    const candidates = section[0];
    if (!Array.isArray(candidates)) return null;

    let text = "";
    let imageNode = null;

    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) continue;

      const responseArr = candidate[1];
      if (Array.isArray(responseArr) && typeof responseArr[0] === "string") {
        const candidateText = normalizeText(responseArr[0]);
        if (isLikelyMessageText(candidateText)) {
          text = candidateText;
        }
      }

      if (!text) {
        const withoutThoughts = candidate.filter((_, index) => index !== 37);
        const candidateText = findFirstString(withoutThoughts, true);
        if (candidateText && isLikelyMessageText(candidateText)) {
          text = candidateText;
        }
      }

      if (!imageNode) imageNode = candidate;
    }

    const imageUrls = imageNode ? extractGeminiImageUrls(imageNode) : [];
    const imageMarkdown = imageUrls.map((url) => `![Generated image](${url})`);
    const effectiveImages =
      !text && imageMarkdown.length > 1
        ? [imageMarkdown[imageMarkdown.length - 1]]
        : imageMarkdown;

    if (text && effectiveImages.length) {
      return `${text}\n\n${effectiveImages.join("\n")}`;
    }
    if (text) return text;
    if (effectiveImages.length) return effectiveImages.join("\n");
    return null;
  }

  function findTurnArrays(payload) {
    const found = [];

    function walk(node, depth) {
      if (!Array.isArray(node) || depth > 12) return;

      if (
        node.length >= 4 &&
        Array.isArray(node[2]) &&
        Array.isArray(node[3]) &&
        (extractUserFromTurn(node) || extractAssistantFromTurn(node))
      ) {
        found.push(node);
        return;
      }

      for (const child of node) {
        if (Array.isArray(child)) walk(child, depth + 1);
      }
    }

    walk(payload, 0);
    return found;
  }

  function tryExtractUserMessage(node) {
    if (
      !Array.isArray(node) ||
      node.length < 3 ||
      node[1] !== 1 ||
      node[2] !== null ||
      !Array.isArray(node[0])
    ) {
      return null;
    }

    const content = findFirstString(node[0], false);
    return content && isLikelyMessageText(content) ? content : null;
  }

  function tryExtractAssistantMessage(node) {
    const messageId = node[0];
    if (typeof messageId !== "string" || !/^rc_[a-zA-Z0-9_]+$/.test(messageId)) {
      return null;
    }

    const source = Array.isArray(node[1])
      ? node[1].filter((_, index) => index !== 37)
      : node[1];

    const text = findFirstString(source, true);
    const normalizedText = text && isLikelyMessageText(text) ? text : "";
    const imageUrls = extractGeminiImageUrls(node);
    const imageMarkdown = imageUrls.map((url) => `![Generated image](${url})`);
    const effectiveImages =
      !normalizedText && imageMarkdown.length > 1
        ? [imageMarkdown[imageMarkdown.length - 1]]
        : imageMarkdown;

    if (!normalizedText && !effectiveImages.length) return null;
    if (normalizedText && effectiveImages.length) {
      return `${normalizedText}\n\n${effectiveImages.join("\n")}`;
    }
    if (normalizedText) return normalizedText;
    return effectiveImages.join("\n");
  }

  function dedupeMessages(messages) {
    const deduped = [];
    for (const message of messages) {
      const content = normalizeText(message.content);
      if (!content) continue;
      const previous = deduped[deduped.length - 1];
      if (previous?.role === message.role && previous.content === content) continue;
      deduped.push({ role: message.role, content });
    }
    return deduped;
  }

  function extractMessagesFromPayload(payload) {
    const turnMessages = [];
    const turns = findTurnArrays(payload);

    if (turns.length) {
      for (const turn of turns) {
        const userText = extractUserFromTurn(turn);
        const assistantText = extractAssistantFromTurn(turn);
        if (userText) turnMessages.push({ role: "user", content: userText });
        if (assistantText) turnMessages.push({ role: "assistant", content: assistantText });
      }
    }

    if (turnMessages.length) {
      return dedupeMessages(turnMessages);
    }

    const collected = [];
    const stack = [payload];

    while (stack.length) {
      const node = stack.pop();
      if (!Array.isArray(node)) continue;

      const userText = tryExtractUserMessage(node);
      if (userText) collected.push({ role: "user", content: userText });

      const assistantText = tryExtractAssistantMessage(node);
      if (assistantText) collected.push({ role: "assistant", content: assistantText });

      for (let i = node.length - 1; i >= 0; i -= 1) stack.push(node[i]);
    }

    return dedupeMessages(collected);
  }

  function deriveTitle(payloadTitle, messages) {
    const cleanedPayloadTitle = normalizeText(payloadTitle || "");
    if (cleanedPayloadTitle) {
      return cleanedPayloadTitle
        .replace(/\s*[|–—-]\s*Gemini.*$/i, "")
        .replace(/\s*-\s*Gemini.*$/i, "")
        .trim();
    }

    const firstUser = messages.find((message) => message.role === "user");
    if (!firstUser) return undefined;

    const snippet = firstUser.content.slice(0, 80);
    return firstUser.content.length > 80 ? `${snippet}...` : snippet;
  }

  async function fetchConversation(payload) {
    const href = payload?.href || location.href;
    const conversationId = extractConversationId(href);
    if (!conversationId) {
      throw new Error(
        "Gemini fast mode: no conversation id in URL (expected /app/<id>)"
      );
    }

    const pathPrefix = extractPathPrefix(href);
    const runtimeParams = resolveRuntimeParams();
    const rawPayload = await fetchConversationPayload(
      conversationId,
      runtimeParams,
      pathPrefix
    );
    const messages = extractMessagesFromPayload(rawPayload);

    if (!messages.length) {
      throw new Error("Gemini fast mode: conversation payload contained no messages");
    }

    return {
      title: deriveTitle(payload?.title, messages),
      messages
    };
  }

  ready((page) => {
    page.register("gemini.fetchConversation", fetchConversation);
  });
})();
