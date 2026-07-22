/**
 * ============================================================================
 * Conversation Extractor — Shared Contracts (read before editing)
 * ============================================================================
 *
 * WHY THIS EXISTS
 * Parallel agents implement formats / scrapers independently. Everything routes
 * through globalThis.CE so popup UI, content scripts, and format modules never
 * invent competing APIs or duplicate serializers inside content.js.
 *
 * LOAD ORDER (manifest + popup.html must match)
 *   1. shared/namespace.js
 *   2. shared/download.js
 *   3. shared/format-registry.js
 *   4. shared/formats/markdown.js
 *   5. shared/formats/json.js
 *   6. shared/formats/txt.js
 *   7. shared/scroll-harvest.js     (content scripts only)
 *   8. shared/scrape-claude.js      (content scripts only)
 *   9. shared/scrape-chatgpt.js     (content scripts only)
 *  10. shared/scrape-gemini.js      (content scripts only)
 *  11. content.js  (or popup.js — popup skips scrapers / scroll-harvest)
 *
 * PLATFORMS
 *   chatgpt → CE.scrapeChatGPTFull()
 *   claude  → CE.scrapeClaudeFull()
 *   gemini  → CE.scrapeGeminiFull()
 *
 * STORAGE KEYS (chrome.storage.local)
 *   exportFormat: string  — MUST be a registered format id
 *                           ("markdown" | "json" | "txt")
 *
 * CONVERSATION SHAPE (scrapers → formatters)
 *   {
 *     platform: "chatgpt" | "claude",
 *     title: string,
 *     url: string,
 *     exportedAt: ISO-8601 string,
 *     messages: Array<{ role: "user" | "assistant", content: string }>
 *   }
 *   `content` is plain text with Markdown-ish structure already normalized by
 *   the scraper (headings, lists, fenced code). Formatters must not re-scrape DOM.
 *
 * FORMAT MODULE CONTRACT
 *   Each file under shared/formats/ MUST call exactly once:
 *
 *     CE.registerFormat({
 *       id: "markdown",          // stable storage / <option value>
 *       label: "Markdown",       // popup select label
 *       extension: "md",         // download filename suffix (no dot)
 *       mime: "text/markdown",   // Blob type
 *       serialize(conversation)  // returns string file body
 *     });
 *
 *   Rules:
 *   - Do NOT touch popup.html option lists (registry fills them).
 *   - Do NOT edit other format files.
 *   - Do NOT put scraper logic in format files.
 *   - serialize() must be pure: conversation in → string out.
 *
 * POPUP REACHABILITY
 *   popup.js calls:
 *     CE.populateFormatSelect(selectEl, selectedId)
 *     CE.isFormatId(id)
 *   On change → chrome.storage.local.set({ exportFormat: id })
 *
 * CONTENT SCRIPT REACHABILITY
 *   content.js calls:
 *     const fmt = CE.getFormat(exportFormatId) || CE.getFormat("markdown")
 *     const body = fmt.serialize(conversation)
 *     CE.downloadFile(`${CE.slugify(title)}.${fmt.extension}`, body, fmt.mime)
 *
 * CLAUDE SCRAPER CONTRACT (content.js / optional shared/scrape-claude.js)
 *   Must return the FULL conversation, not only currently mounted virtual rows.
 *   Preferred strategy: locate scroll root → scroll top→bottom (or bottom→top
 *   then top→bottom) → accumulate messages keyed by stable id/fingerprint →
 *   restore scroll position → return ordered messages[].
 *   Expose as: CE.scrapeClaudeFull?.() or keep scrapeClaude() inside content.js
 *   but route scrapeConversation() through it.
 *
 * OWNERSHIP / CONFLICT AVOIDANCE
 *   Agent Claude-full-capture : content.js Claude scrape path only (+ helpers)
 *   Agent format-markdown     : shared/formats/markdown.js only
 *   Agent format-json         : shared/formats/json.js only
 *   Agent format-txt          : shared/formats/txt.js only
 *   Agent unify               : wiring (manifest, popup.js, content.js glue),
 *                               remove dead inline serializers, smoke-check
 *
 * Do not rename CE.registerFormat / CE.getFormat / CE.listFormats without
 * updating every consumer in the same change.
 */
void 0;
