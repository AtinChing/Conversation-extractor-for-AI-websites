/**
 * ============================================================================
 * Conversation Extractor — Shared Contracts (read before editing)
 * ============================================================================
 *
 * LOAD ORDER — isolated world (manifest content_scripts, default world)
 *   1. shared/namespace.js
 *   2. shared/download.js
 *   3. shared/format-registry.js
 *   4. shared/formats/markdown.js | json.js | txt.js
 *   5. shared/scroll-harvest.js
 *   6. shared/scrape-claude.js | scrape-chatgpt.js | scrape-gemini.js   (SLOW)
 *   7. shared/scrape-fast.js                                           (FAST orchestrator)
 *   8. content.js
 *
 * LOAD ORDER — MAIN world (manifest content_scripts world: "MAIN")
 *   1. shared/page-bridge.js
 *   2. shared/main/chatgpt-fast.js
 *   3. shared/main/claude-fast.js
 *   4. shared/main/gemini-fast.js
 *   (popup.html does NOT load MAIN / scrape scripts)
 *
 * STORAGE KEYS (chrome.storage.local)
 *   exportFormat: "markdown" | "json" | "txt"
 *   fastModeEnabled: boolean
 *     When true, content.js tries CE.scrapeFast(platform) first.
 *     On any throw / empty result → falls back to slow DOM scroll scrapers.
 *
 * PLATFORMS
 *   chatgpt → fast: page handler "chatgpt.fetchConversation"
 *             slow: CE.scrapeChatGPTFull()
 *   claude  → fast: page handler "claude.fetchConversation"
 *             slow: CE.scrapeClaudeFull()
 *   gemini  → fast: page handler "gemini.fetchConversation"
 *             slow: CE.scrapeGeminiFull()
 *
 * FAST MODE PAGE BRIDGE
 *   MAIN world exposes window.__CE_PAGE__:
 *     register(actionName, async (payload) => result)
 *   Isolated world calls:
 *     const result = await CE.pageRequest(actionName, payload)
 *   Result MUST be:
 *     { title?: string, messages: Array<{ role: "user"|"assistant", content: string }> }
 *   On failure the MAIN handler should throw (bridge turns it into a rejected promise).
 *
 * FAST SCRAPER OWNERSHIP (one file each — do not edit siblings)
 *   Agent chatgpt-fast : shared/main/chatgpt-fast.js only
 *   Agent claude-fast  : shared/main/claude-fast.js only
 *   Agent gemini-fast  : shared/main/gemini-fast.js only
 *   Agent popup-ui     : popup.html, popup.js, popup.css only (Fast Mode toggle + warning)
 *   Agent unify        : content.js / scrape-fast.js / manifest glue only if needed
 *
 * Each MAIN fast file MUST:
 *   1. Wait for window.__CE_PAGE__
 *   2. Call __CE_PAGE__.register("<platform>.fetchConversation", handler)
 *   3. Use the page's authenticated session (cookies / tokens already on page)
 *   4. Return the FULL conversation (not only visible DOM)
 *   5. Never call DOM scroll harvest (that is slow mode)
 *
 * Do not rename CE.pageRequest / CE.scrapeFast / __CE_PAGE__.register without
 * updating every consumer in the same change.
 */
void 0;
