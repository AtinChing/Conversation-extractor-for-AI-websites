(() => {
  "use strict";

  const CE = (globalThis.CE = globalThis.CE || {});
  const formats = new Map();

  /**
   * Register an export format. Safe to call once per id; later calls replace.
   * @param {import('./namespace.js').CEFormat} format
   */
  CE.registerFormat = function registerFormat(format) {
    if (!format || typeof format !== "object") {
      throw new Error("CE.registerFormat: format object required");
    }
    const { id, label, extension, mime, serialize } = format;
    if (!id || typeof id !== "string") {
      throw new Error("CE.registerFormat: id string required");
    }
    if (!label || typeof label !== "string") {
      throw new Error(`CE.registerFormat(${id}): label required`);
    }
    if (!extension || typeof extension !== "string") {
      throw new Error(`CE.registerFormat(${id}): extension required`);
    }
    if (!mime || typeof mime !== "string") {
      throw new Error(`CE.registerFormat(${id}): mime required`);
    }
    if (typeof serialize !== "function") {
      throw new Error(`CE.registerFormat(${id}): serialize(fn) required`);
    }
    formats.set(id, Object.freeze({ id, label, extension, mime, serialize }));
  };

  CE.getFormat = function getFormat(id) {
    return formats.get(id) || null;
  };

  CE.isFormatId = function isFormatId(id) {
    return formats.has(id);
  };

  CE.listFormats = function listFormats() {
    return [...formats.values()];
  };

  /**
   * Rebuild <select> options from the registry. Preserves selection when valid.
   * @param {HTMLSelectElement} selectEl
   * @param {string} [selectedId]
   */
  CE.populateFormatSelect = function populateFormatSelect(selectEl, selectedId) {
    if (!selectEl) return;
    const list = CE.listFormats();
    const preferred =
      (selectedId && formats.has(selectedId) && selectedId) ||
      (formats.has(CE.DEFAULT_FORMAT_ID) && CE.DEFAULT_FORMAT_ID) ||
      (list[0] && list[0].id) ||
      "";

    selectEl.replaceChildren();
    for (const format of list) {
      const option = document.createElement("option");
      option.value = format.id;
      option.textContent = format.label;
      selectEl.appendChild(option);
    }
    if (preferred) selectEl.value = preferred;
  };
})();
