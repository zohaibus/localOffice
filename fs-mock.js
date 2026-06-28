'use strict';
// ════════════════════════════════════════════════════════════════════
// In-memory File System Access API mock for Playwright (zero dependencies).
//
// The native showOpenFilePicker / showSaveFilePicker dialogs can't run in a
// headless browser, so without this the suites only ever exercise the
// download/upload fallback - leaving the PRIMARY Chrome/Edge path (real
// FileSystemFileHandle + createWritable/write/close + getFile) uncovered.
//
// Install BEFORE page.goto:   await page.addInitScript(fsMockInit);
// Then in a page.evaluate:
//   • window.__virtualFS  - Map<name, serializedText> (assert against this)
//   • window.__fsPick     - set to the name showOpenFilePicker should return
//
// It makes `'showSaveFilePicker' in window` true, so the tools take the FS path.
// ════════════════════════════════════════════════════════════════════
function fsMockInit() {
  const FS = window.__virtualFS = new Map();
  window.__fsPick = null;
  class MockFileHandle {
    constructor(name) { this.name = name; this.kind = 'file'; }
    async getFile() { return new File([FS.get(this.name) || ''], this.name, { type: 'application/json' }); }
    async createWritable() {
      const name = this.name; let buf = '';
      return {
        async write(data) { buf = (typeof data === 'string') ? data : (data && data.data != null ? data.data : String(data)); },
        async truncate() {}, async seek() {},
        async close() { FS.set(name, buf); },
      };
    }
  }
  window.__MockFileHandle = MockFileHandle;
  window.showSaveFilePicker = async (opts) => new MockFileHandle((opts && opts.suggestedName) || 'untitled.localoffice.json');
  window.showOpenFilePicker = async () => {
    const n = window.__fsPick;
    if (!n || !FS.has(n)) { const e = new Error('No file selected.'); e.name = 'AbortError'; throw e; }
    return [new MockFileHandle(n)];
  };
}
module.exports = { fsMockInit };
