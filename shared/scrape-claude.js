(() => {
  "use strict";

  const CE = (globalThis.CE = globalThis.CE || {});

  const SETTLE_MS = 180;
  const TOP_STABLE_ROUNDS = 4;
  const BOTTOM_STABLE_ROUNDS = 3;
  const MAX_SCROLL_STEPS = 400;
  const PROGRESS_BUTTON = "#ce-download-transcript .ce-label";

  // Page timers are heavily throttled in background tabs; Worker timers are not.
  let sleepWorker = null;
  let sleepSeq = 0;
  /** @type {Map<number, () => void>} */
  const sleepWaiters = new Map();

  /**
   * OWNER: claude-full-capture agent
   *
   * Captures the entire Claude conversation by walking the virtualized scroll
   * container so unmounted rows remount, then accumulates by stable fingerprint.
   *
   * @returns {Promise<Array<{role: "user"|"assistant", content: string}>>}
   */
  CE.scrapeClaudeFull = async function scrapeClaudeFull() {
    const scroller = findClaudeScrollRoot();
    if (!scroller) {
      return CE._scrapeClaudeMountedOnly();
    }

    const maxScroll = () => Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (maxScroll() < 8) {
      // Short chat / everything already mounted — no virtualization walk needed.
      return CE._scrapeClaudeMountedOnly();
    }

    const savedTop = scroller.scrollTop;
    const savedLeft = scroller.scrollLeft;
    /** @type {Map<string, {role: "user"|"assistant", content: string, order: number}>} */
    const captured = new Map();
    let order = 0;

    const harvest = () => {
      for (const message of extractMountedMessages(scroller)) {
        const key = messageKey(message);
        if (captured.has(key)) continue;
        captured.set(key, {
          role: message.role,
          content: message.content,
          order: order++
        });
      }
      setScanProgress(captured.size);
    };

    try {
      setScanProgress(0);

      // Reach the true top (older turns may lazy-append and push scrollTop).
      await scrollToTopStable(scroller, harvest);

      // Top → bottom pass builds chronological order via first-seen insertion.
      captured.clear();
      order = 0;
      await applyScroll(scroller, 0);
      harvest();

      let stagnant = 0;
      let steps = 0;
      while (steps < MAX_SCROLL_STEPS && stagnant < BOTTOM_STABLE_ROUNDS) {
        steps += 1;
        const beforeCount = captured.size;
        const beforeTop = scroller.scrollTop;
        const limit = maxScroll();
        const step = Math.max(120, Math.floor(scroller.clientHeight * 0.7));

        if (beforeTop >= limit - 2) {
          // Nudge to absolute bottom in case height grew mid-pass.
          await applyScroll(scroller, maxScroll());
          harvest();
          if (captured.size === beforeCount && scroller.scrollTop >= maxScroll() - 2) {
            stagnant += 1;
          } else {
            stagnant = 0;
          }
          continue;
        }

        await applyScroll(scroller, Math.min(beforeTop + step, limit));
        // If the virtualizer prepended/appended and scrollHeight grew, wait once more.
        if (maxScroll() > limit) {
          await backgroundSafeSleep(SETTLE_MS);
          nudgeVirtualizer(scroller);
        }
        harvest();

        if (captured.size === beforeCount && scroller.scrollTop === beforeTop) {
          stagnant += 1;
        } else {
          stagnant = 0;
        }
      }

      await applyScroll(scroller, maxScroll());
      harvest();

      const messages = [...captured.values()]
        .sort((a, b) => a.order - b.order)
        .map(({ role, content }) => ({ role, content }));

      return messages.length ? dedupeAdjacent(messages) : CE._scrapeClaudeMountedOnly();
    } finally {
      try {
        scroller.scrollTop = savedTop;
        scroller.scrollLeft = savedLeft;
      } catch (_) {
        /* ignore restore failures */
      }
      disposeSleepWorker();
    }
  };

  CE._scrapeClaudeMountedOnly = function scrapeClaudeMountedOnly() {
    return extractMountedMessages(document).map(({ role, content }) => ({
      role,
      content
    }));
  };

  async function scrollToTopStable(scroller, harvest) {
    let stable = 0;
    let rounds = 0;
    while (rounds < MAX_SCROLL_STEPS && stable < TOP_STABLE_ROUNDS) {
      rounds += 1;
      const beforeHeight = scroller.scrollHeight;
      const beforeTop = scroller.scrollTop;
      await applyScroll(scroller, 0);
      harvest();

      const grew = scroller.scrollHeight > beforeHeight + 2;
      const notAtTop = scroller.scrollTop > 2;
      if (grew || notAtTop || beforeTop > 2) {
        stable = 0;
      } else {
        stable += 1;
      }
    }
  }

  async function applyScroll(scroller, top) {
    scroller.scrollTop = top;
    nudgeVirtualizer(scroller);
    await backgroundSafeSleep(SETTLE_MS);
  }

  /**
   * Virtualizers often listen for scroll + layout; force both so remounts still
   * happen when the tab is hidden and rAF is paused.
   */
  function nudgeVirtualizer(scroller) {
    try {
      void scroller.offsetHeight;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      if (typeof scroller.onscroll === "function") {
        scroller.onscroll(new Event("scroll"));
      }
    } catch (_) {
      /* ignore */
    }
  }

  /**
   * @param {ParentNode} root
   * @returns {Array<{role: "user"|"assistant", content: string, node: Element}>}
   */
  function extractMountedMessages(root) {
    const scope = root instanceof Element || root instanceof Document ? root : document;
    const nodes = collectClaudeMessages(scope);
    const messages = [];

    for (const node of nodes) {
      const role = resolveClaudeRole(node);
      if (!role) continue;

      const clone = node.cloneNode(true);
      stripClaudeArtifacts(clone);
      const contentRoot = findClaudeContentRoot(clone) || clone;
      const content = CE.serializeRichContent
        ? CE.serializeRichContent(contentRoot)
        : (contentRoot.innerText || contentRoot.textContent || "").trim();
      if (!content.trim()) continue;
      messages.push({ role, content: content.trim(), node });
    }

    return dedupeAdjacent(messages);
  }

  function collectClaudeMessages(root) {
    const selector = [
      '[data-testid="user-message"]',
      '[data-testid="human-message"]',
      '[data-testid="message-human"]',
      ".font-user-message",
      ".\\!font-user-message",
      '[class*="font-user-message"]',
      ".font-claude-response",
      '[data-testid="ai-message"]',
      '[data-testid="message-assistant"]',
      ".font-claude-message",
      ".assistant-message"
    ].join(", ");

    const nodes = dedupeElements([...root.querySelectorAll(selector)]).filter((el) =>
      isReadableCandidate(el)
    );

    const outermost = nodes.filter(
      (el) => !nodes.some((other) => other !== el && other.contains(el))
    );

    if (outermost.length) return outermost.sort(byDocumentOrder);

    return [...root.querySelectorAll("[data-test-render-count]")]
      .filter((el) => isReadableCandidate(el))
      .sort(byDocumentOrder);
  }

  function resolveClaudeRole(node) {
    const userSelector = [
      '[data-testid="user-message"]',
      '[data-testid="human-message"]',
      '[data-testid="message-human"]',
      ".font-user-message",
      ".\\!font-user-message",
      '[class*="font-user-message"]'
    ].join(", ");

    const assistantSelector = [
      ".font-claude-response",
      '[data-testid="ai-message"]',
      '[data-testid="message-assistant"]',
      ".font-claude-message",
      ".assistant-message"
    ].join(", ");

    if (node.matches(userSelector)) return "user";
    if (node.matches(assistantSelector)) return "assistant";
    if (node.querySelector(userSelector)) return "user";
    if (node.querySelector(assistantSelector)) return "assistant";
    return null;
  }

  function findClaudeContentRoot(node) {
    const selectors = [
      ".standard-markdown",
      ".progressive-markdown",
      ".font-claude-response-body",
      ".markdown",
      ".prose",
      '[class*="markdown"]'
    ];
    for (const selector of selectors) {
      const found = node.querySelector(selector);
      if (found && found.textContent && found.textContent.trim()) return found;
    }
    return node;
  }

  function stripClaudeArtifacts(root) {
    root
      .querySelectorAll(
        'button, [data-testid="action-bar-copy"], [data-testid*="feedback"], [aria-label*="Copy"], [aria-label*="Good response"], [aria-label*="Bad response"], [aria-label*="Retry"], [aria-label*="Edit"], [class*="CopyButton"], [class*="feedback"], svg, style, script, noscript'
      )
      .forEach((el) => el.remove());
  }

  /**
   * Prefer the innermost overflow scroller that contains chat messages and can
   * actually scroll. Falls back to document scrollingElement.
   */
  function findClaudeScrollRoot() {
    const mounted = collectClaudeMessages(document);
    const seeds = mounted.length
      ? mounted
      : [
          ...document.querySelectorAll(
            '[data-test-render-count], main, [class*="overflow-y-auto"], [class*="overflow-y-scroll"]'
          )
        ];

    /** @type {HTMLElement[]} */
    const candidates = [];

    for (const seed of seeds) {
      let el = seed instanceof HTMLElement ? seed : seed.parentElement;
      while (el && el !== document.documentElement) {
        if (isScrollableElement(el) && !isComposerLike(el)) {
          candidates.push(el);
        }
        el = el.parentElement;
      }
    }

    // Also consider common Claude / Claude Code chat scrollers.
    for (const el of document.querySelectorAll(
      '.h-full.overflow-y-auto, .overflow-y-auto.overflow-x-hidden, [class*="overflow-y-auto"]'
    )) {
      if (el instanceof HTMLElement && isScrollableElement(el) && !isComposerLike(el)) {
        candidates.push(el);
      }
    }

    const unique = dedupeElements(candidates);
    if (!unique.length) {
      const doc = document.scrollingElement;
      if (doc instanceof HTMLElement && doc.scrollHeight > doc.clientHeight + 8) {
        return doc;
      }
      return null;
    }

    // Innermost first: prefer the smallest scrollable that still contains messages.
    unique.sort((a, b) => {
      const aMsgs = collectClaudeMessages(a).length;
      const bMsgs = collectClaudeMessages(b).length;
      if (aMsgs !== bMsgs) return bMsgs - aMsgs;
      return a.clientHeight - b.clientHeight;
    });

    const withMessages = unique.find((el) => collectClaudeMessages(el).length > 0);
    return withMessages || unique[0];
  }

  function isScrollableElement(el) {
    if (!(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    const oy = style.overflowY;
    if (!(oy === "auto" || oy === "scroll" || oy === "overlay")) return false;
    return el.scrollHeight > el.clientHeight + 1;
  }

  function isComposerLike(el) {
    if (!(el instanceof HTMLElement)) return true;
    if (
      el.matches(
        "footer, form, [data-testid*='composer'], [data-testid*='chat-input'], [class*='composer']"
      )
    ) {
      return true;
    }
    const hasInput = !!el.querySelector("textarea, [contenteditable='true']");
    const hasMessages = !!el.querySelector(
      '[data-testid="user-message"], [data-testid="human-message"], .font-claude-response, [data-test-render-count]'
    );
    // Sticky composer strips: input, no messages, short height.
    if (hasInput && !hasMessages && el.clientHeight > 0 && el.clientHeight < 180) {
      return true;
    }
    return false;
  }

  function messageKey(message) {
    const { role, content, node } = message;
    const indexed =
      node.closest?.("[data-index]") ||
      node.closest?.("[data-item-index]") ||
      node.closest?.("[data-virtualized-index]");
    if (indexed) {
      const idx =
        indexed.getAttribute("data-index") ||
        indexed.getAttribute("data-item-index") ||
        indexed.getAttribute("data-virtualized-index");
      return `${role}:idx:${idx}`;
    }

    const idHost = node.closest?.("[data-message-id]");
    const messageId = idHost?.getAttribute("data-message-id");
    if (messageId) return `${role}:id:${messageId}`;

    const renderHost = node.closest?.("[data-test-render-count]");
    const anchor = renderHost || node;
    // Bucket Y so remount jitter does not create duplicate keys.
    const absY = Math.round(absoluteOffsetTop(anchor) / 24) * 24;
    return `${role}:y:${absY}:${fingerprintContent(content)}`;
  }

  function absoluteOffsetTop(el) {
    let top = 0;
    let cur = el;
    while (cur instanceof HTMLElement) {
      top += cur.offsetTop;
      cur = cur.offsetParent;
    }
    // Fallback when offsetParent chain is broken by transforms/virtualizers.
    if (!top && el.getBoundingClientRect) {
      const scrollerTop =
        (document.scrollingElement && document.scrollingElement.scrollTop) ||
        window.scrollY ||
        0;
      top = el.getBoundingClientRect().top + scrollerTop;
    }
    return top;
  }

  function fingerprintContent(content) {
    const norm = String(content).replace(/\s+/g, " ").trim();
    return `${norm.length}:${norm.slice(0, 96)}:${norm.slice(-96)}`;
  }

  function setScanProgress(count) {
    const label = document.querySelector(PROGRESS_BUTTON);
    if (!label) return;
    const hidden = document.visibilityState === "hidden";
    const base = count > 0 ? `Scanning ${count}…` : "Scanning…";
    label.textContent = hidden ? `${base} (background)` : base;
  }

  /**
   * Sleep that keeps ticking in background tabs via a dedicated Worker.
   * Falls back to window.setTimeout if Workers are unavailable.
   */
  function backgroundSafeSleep(ms) {
    return new Promise((resolve) => {
      try {
        const worker = ensureSleepWorker();
        const id = ++sleepSeq;
        sleepWaiters.set(id, resolve);
        worker.postMessage({ id, ms: Math.max(0, ms | 0) });
      } catch (_) {
        window.setTimeout(resolve, ms);
      }
    });
  }

  function ensureSleepWorker() {
    if (sleepWorker) return sleepWorker;

    // Prefer extension URL worker (survives page CSP). Fall back to blob worker.
    let workerUrl = null;
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
        workerUrl = chrome.runtime.getURL("shared/sleep-worker.js");
      }
    } catch (_) {
      workerUrl = null;
    }

    if (workerUrl) {
      sleepWorker = new Worker(workerUrl);
    } else {
      const source =
        "self.onmessage=function(e){var d=e.data||{};setTimeout(function(){self.postMessage({id:d.id})},d.ms||0)};";
      const blob = new Blob([source], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      sleepWorker = new Worker(url);
      URL.revokeObjectURL(url);
    }

    sleepWorker.onmessage = (event) => {
      const id = event?.data?.id;
      const waiter = sleepWaiters.get(id);
      if (!waiter) return;
      sleepWaiters.delete(id);
      waiter();
    };
    sleepWorker.onerror = () => {
      // Fail open: resolve any pending waiters so the scan cannot hang forever.
      for (const waiter of sleepWaiters.values()) waiter();
      sleepWaiters.clear();
      disposeSleepWorker();
    };
    return sleepWorker;
  }

  function disposeSleepWorker() {
    if (!sleepWorker) return;
    try {
      sleepWorker.terminate();
    } catch (_) {
      /* ignore */
    }
    sleepWorker = null;
    for (const waiter of sleepWaiters.values()) waiter();
    sleepWaiters.clear();
  }

  function isReadableCandidate(el) {
    if (!(el instanceof HTMLElement)) return false;
    if (el.closest("#ce-download-transcript")) return false;
    const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    return text.length >= 1;
  }

  function dedupeAdjacent(messages) {
    const result = [];
    for (const message of messages) {
      const prev = result[result.length - 1];
      if (prev && prev.role === message.role && prev.content === message.content) {
        continue;
      }
      result.push(message);
    }
    return result;
  }

  function dedupeElements(elements) {
    return [...new Set(elements)];
  }

  function byDocumentOrder(a, b) {
    if (a === b) return 0;
    const position = a.compareDocumentPosition(b);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  }
})();
