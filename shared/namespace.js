(() => {
  "use strict";

  const CE = (globalThis.CE = globalThis.CE || {});

  CE.VERSION = "1.0.0";
  CE.DEFAULT_FORMAT_ID = "markdown";

  CE.STORAGE_DEFAULTS = Object.freeze({
    exportFormat: CE.DEFAULT_FORMAT_ID,
    fastModeEnabled: true
  });

  /**
   * @typedef {Object} CEMessage
   * @property {"user"|"assistant"} role
   * @property {string} content
   */

  /**
   * @typedef {Object} CEConversation
   * @property {"chatgpt"|"claude"|"gemini"} platform
   * @property {string} title
   * @property {string} url
   * @property {string} exportedAt
   * @property {CEMessage[]} messages
   */

  /**
   * @typedef {Object} CEFormat
   * @property {string} id
   * @property {string} label
   * @property {string} extension
   * @property {string} mime
   * @property {(conversation: CEConversation) => string} serialize
   */
})();
