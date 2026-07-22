(() => {
  "use strict";

  const CE = (globalThis.CE = globalThis.CE || {});

  const DEFAULT_SETTLE_MS = 180;
  const DEFAULT_TOP_STABLE_ROUNDS = 4;
  const DEFAULT_BOTTOM_STABLE_ROUNDS = 3;
  const DEFAULT_MAX_SCROLL_STEPS = 400;
  const PROGRESS_BUTTON = "#ce-download-transcript .ce-label";

  let sleepWorker = null;
  let sleepSeq = 0;
  /** @type {Map<number, () => void>} */
  const sleepWaiters = new Map();

  /**
   * Scroll a virtualized chat container top→bottom, harvesting messages as rows
   * remount. Restores scroll position and disposes the sleep worker afterward.
   *
   * @param {object} options
   * @param {() => HTMLElement|null} options.findScroller
   * @param {(root?: ParentNode) => Array<{role:string, content:string, node?: Element}>} options.extractMounted
   * @param {(message: {role:string, content:string, node?: Element}) => string} [options.keyFor]
   * @param {() => Array<{role:string, content:string}>} [options.fallback]
   * @param {number} [options.settleMs]
   * @returns {Promise<Array<{role: "user"|"assistant", content: string}>>}
   */
  CE.harvestByScrolling = async function harvestByScrolling(options) {
    const extractMounted = options.extractMounted;
    const keyFor = options.keyFor || defaultMessageKey;
    const settleMs = options.settleMs || DEFAULT_SETTLE_MS;
    const fallback =
      options.fallback ||
      (() =>
        dedupeAdjacent(
          extractMounted(document).map(({ role, content }) => ({ role, content }))
        ));

    const scroller = options.findScroller();
    if (!scroller) return fallback();

    const maxScroll = () => Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (maxScroll() < 8) return fallback();

    const savedTop = scroller.scrollTop;
    const savedLeft = scroller.scrollLeft;
    /** @type {Map<string, {role: string, content: string, order: number}>} */
    const captured = new Map();
    let order = 0;

    const harvest = () => {
      for (const message of extractMounted(scroller)) {
        if (!message?.role || !message?.content) continue;
        const key = keyFor(message);
        if (captured.has(key)) continue;
        captured.set(key, {
          role: message.role,
          content: message.content,
          order: order++
        });
      }
      CE.setScanProgress(captured.size);
    };

    try {
      CE.setScanProgress(0);
      await scrollToTopStable(scroller, harvest, settleMs);

      captured.clear();
      order = 0;
      await applyScroll(scroller, 0, settleMs);
      harvest();

      let stagnant = 0;
      let steps = 0;
      while (
        steps < DEFAULT_MAX_SCROLL_STEPS &&
        stagnant < DEFAULT_BOTTOM_STABLE_ROUNDS
      ) {
        steps += 1;
        const beforeCount = captured.size;
        const beforeTop = scroller.scrollTop;
        const limit = maxScroll();
        const step = Math.max(120, Math.floor(scroller.clientHeight * 0.7));

        if (beforeTop >= limit - 2) {
          await applyScroll(scroller, maxScroll(), settleMs);
          harvest();
          if (captured.size === beforeCount && scroller.scrollTop >= maxScroll() - 2) {
            stagnant += 1;
          } else {
            stagnant = 0;
          }
          continue;
        }

        await applyScroll(scroller, Math.min(beforeTop + step, limit), settleMs);
        if (maxScroll() > limit) {
          await CE.backgroundSafeSleep(settleMs);
          nudgeVirtualizer(scroller);
        }
        harvest();

        if (captured.size === beforeCount && scroller.scrollTop === beforeTop) {
          stagnant += 1;
        } else {
          stagnant = 0;
        }
      }

      await applyScroll(scroller, maxScroll(), settleMs);
      harvest();

      const messages = [...captured.values()]
        .sort((a, b) => a.order - b.order)
        .map(({ role, content }) => ({
          role: role === "user" ? "user" : "assistant",
          content
        }));

      return messages.length ? dedupeAdjacent(messages) : fallback();
    } finally {
      try {
        scroller.scrollTop = savedTop;
        scroller.scrollLeft = savedLeft;
      } catch (_) {
        /* ignore */
      }
      CE.disposeSleepWorker();
    }
  };

  CE.setScanProgress = function setScanProgress(count) {
    const label = document.querySelector(PROGRESS_BUTTON);
    if (!label) return;
    const hidden = document.visibilityState === "hidden";
    const base = count > 0 ? `Scanning ${count}…` : "Scanning…";
    label.textContent = hidden ? `${base} (background)` : base;
  };

  CE.backgroundSafeSleep = function backgroundSafeSleep(ms) {
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
  };

  CE.disposeSleepWorker = function disposeSleepWorker() {
    if (!sleepWorker) return;
    try {
      sleepWorker.terminate();
    } catch (_) {
      /* ignore */
    }
    sleepWorker = null;
    for (const waiter of sleepWaiters.values()) waiter();
    sleepWaiters.clear();
  };

  CE.findScrollRootNear = function findScrollRootNear(seeds, extraSelectors) {
    /** @type {HTMLElement[]} */
    const candidates = [];

    for (const seed of seeds) {
      let el = seed instanceof HTMLElement ? seed : seed?.parentElement;
      while (el && el !== document.documentElement) {
        if (isScrollableElement(el) && !isComposerLike(el)) {
          candidates.push(el);
        }
        el = el.parentElement;
      }
    }

    if (extraSelectors) {
      for (const el of document.querySelectorAll(extraSelectors)) {
        if (el instanceof HTMLElement && isScrollableElement(el) && !isComposerLike(el)) {
          candidates.push(el);
        }
      }
    }

    const unique = [...new Set(candidates)];
    if (!unique.length) {
      const doc = document.scrollingElement;
      if (doc instanceof HTMLElement && doc.scrollHeight > doc.clientHeight + 8) {
        return doc;
      }
      return null;
    }

    unique.sort((a, b) => b.scrollHeight - a.scrollHeight);
    return unique[0];
  };

  CE.fingerprintContent = function fingerprintContent(content) {
    const norm = String(content).replace(/\s+/g, " ").trim();
    return `${norm.length}:${norm.slice(0, 96)}:${norm.slice(-96)}`;
  };

  CE.dedupeAdjacentMessages = dedupeAdjacent;

  async function scrollToTopStable(scroller, harvest, settleMs) {
    let stable = 0;
    let rounds = 0;
    while (rounds < DEFAULT_MAX_SCROLL_STEPS && stable < DEFAULT_TOP_STABLE_ROUNDS) {
      rounds += 1;
      const beforeHeight = scroller.scrollHeight;
      const beforeTop = scroller.scrollTop;
      await applyScroll(scroller, 0, settleMs);
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

  async function applyScroll(scroller, top, settleMs) {
    scroller.scrollTop = top;
    nudgeVirtualizer(scroller);
    await CE.backgroundSafeSleep(settleMs);
  }

  function nudgeVirtualizer(scroller) {
    try {
      void scroller.offsetHeight;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    } catch (_) {
      /* ignore */
    }
  }

  function defaultMessageKey(message) {
    const { role, content, node } = message;
    const indexed =
      node?.closest?.("[data-index]") ||
      node?.closest?.("[data-item-index]") ||
      node?.closest?.("[data-message-id]");
    if (indexed) {
      const idx =
        indexed.getAttribute("data-index") ||
        indexed.getAttribute("data-item-index") ||
        indexed.getAttribute("data-message-id");
      if (idx) return `${role}:id:${idx}`;
    }
    return `${role}:${CE.fingerprintContent(content)}`;
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
      '[data-message-author-role], [data-testid="user-message"], user-query, model-response, .font-claude-response'
    );
    if (hasInput && !hasMessages && el.clientHeight > 0 && el.clientHeight < 180) {
      return true;
    }
    return false;
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

  function ensureSleepWorker() {
    if (sleepWorker) return sleepWorker;

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
      for (const waiter of sleepWaiters.values()) waiter();
      sleepWaiters.clear();
      CE.disposeSleepWorker();
    };
    return sleepWorker;
  }
})();
