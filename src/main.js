import { Plugin, ItemView, Scope } from "obsidian";
import { Constellation } from "./constellation.js";

const VIEW = "nebula";

class NebulaView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf); this.plugin = plugin;
    // Obsidian 1.15 stopped giving every view its own keymap scope (view.scope is now undefined by default).
    // The workspace still routes keys to view.scope when it exists, so create one for the F / Esc hotkeys.
    if (!this.scope) this.scope = new Scope(this.app.scope);
  }
  getViewType() { return VIEW; }
  getDisplayText() { return "Nebula"; }
  getIcon() { return "orbit"; }
  async onOpen() {
    this.addAction("git-fork", "Back to graph view", () => this.plugin.backToGraph());
    this.contentEl.empty(); this.contentEl.addClass("nebula-host"); this.build(); this.scope.register([], "f", () => { this.plugin.toggleFocus(); return false; }); this.scope.register([], "Escape", () => { if (!document.body.classList.contains("nebula-focus")) return true; this.plugin.toggleFocus(); return false; });
    // Obsidian restores this tab at startup before it has resolved the vault's links, so the first build can come up
    // with almost none and every note floats alone on its ring. The "resolved" event does not catch that late resolve,
    // so the plugin checks every 2 s and rebuilds once the counts change and hold still.
  }
  shape() {
    const rl = this.app.metadataCache.resolvedLinks;
    let n = 0;
    for (const a in rl) n += Object.keys(rl[a]).length;
    return `${this.app.vault.getMarkdownFiles().length}:${n}`;
  }
  refresh() {
    const s = this.shape();
    if (this.c && s !== this.built && s === this.seen) this.build();
    this.seen = s;
  }
  build() {
    this.built = this.shape();
    const prev = this.c ? this.c.getView() : null;
    if (this.c) this.c.destroy();
    this.c = null;
    const app = this.app, notes = [], links = [];
    for (const f of app.vault.getMarkdownFiles()) {
      if (f.path.startsWith(".")) continue;
      const i = f.path.indexOf("/");
      notes.push({ id: f.path, name: f.basename, group: i < 0 ? "Home" : f.path.slice(0, i) });
    }
    const rl = app.metadataCache.resolvedLinks;
    for (const a in rl) for (const b in rl[a]) links.push([a, b]);
    try {
      this.c = new Constellation(this.contentEl, { notes, links }, {
        settings: this.plugin.data.settings,
        onSettings: (s) => { this.plugin.data.settings = s; this.plugin.saveData(this.plugin.data); },
        onFocus: () => this.plugin.toggleFocus(),
        onOpen: (path) => { const f = app.vault.getAbstractFileByPath(path); if (f) app.workspace.getLeaf("split", "vertical").openFile(f); },
      });
    } catch (e) {
      // Without WebGL (hardware acceleration off, blocklisted GPU, some VMs) three.js throws and the tab used to stay black.
      console.error("Nebula could not start", e);
      this.contentEl.empty();
      const box = this.contentEl.createDiv({ cls: "nebula-error" });
      box.createEl("b", { text: "Nebula could not start" });
      box.createEl("span", { text: "It needs WebGL. Turn on Settings → Appearance → Hardware acceleration, restart Obsidian, then run Nebula: Refresh view." });
      return;
    }
    if (prev) this.c.setView(prev);
  }
  async onClose() { if (this.c) this.c.destroy(); this.c = null; }
}

export default class Nebula extends Plugin {
  async onload() {
    this.data = Object.assign({ settings: {} }, await this.loadData());
    this.registerView(VIEW, (leaf) => new NebulaView(leaf, this));
    // The ribbon button is an on/off switch: on opens Nebula, off closes it and shows the core graph view.
    const toggle = () => (this.app.workspace.getLeavesOfType(VIEW).length ? this.backToGraph() : open());
    const open = async () => {
      const ex = this.app.workspace.getLeavesOfType(VIEW)[0];
      if (ex) {
        // A Nebula tab restored in the background is a deferred placeholder until shown; calling build() on it threw.
        if (ex.loadIfDeferred) await ex.loadIfDeferred();
        this.app.workspace.revealLeaf(ex); if (ex.view instanceof NebulaView) ex.view.build(); return;
      }
      const leaf = this.app.workspace.getLeaf("tab"); await leaf.setViewState({ type: VIEW, active: true }); this.app.workspace.revealLeaf(leaf);
    };
    this.registerInterval(window.setInterval(() => this.app.workspace.getLeavesOfType(VIEW).forEach((l) => l.view instanceof NebulaView && l.view.refresh()), 2000));
    this.addRibbonIcon("orbit", "Nebula", toggle);
    this.addCommand({ id: "toggle", name: "Toggle view", callback: toggle });
    this.addCommand({ id: "open", name: "Open view", callback: open });
    this.addCommand({ id: "back", name: "Close and open graph view", callback: () => this.backToGraph() });
    this.addCommand({ id: "refresh", name: "Refresh view", callback: () => this.app.workspace.getLeavesOfType(VIEW).forEach((l) => l.view instanceof NebulaView && l.view.build()) });
  }
  backToGraph() {
    if (document.body.classList.contains("nebula-focus")) this.toggleFocus();
    this.app.workspace.detachLeavesOfType(VIEW);
    const g = this.app.workspace.getLeavesOfType("graph")[0];
    if (g) this.app.workspace.revealLeaf(g);
    else this.app.commands.executeCommandById("graph:open");
  }
  toggleFocus() {
    const ws = this.app.workspace, on = !document.body.classList.contains("nebula-focus");
    document.body.classList.toggle("nebula-focus", on);
    if (on) { this._ls = !ws.leftSplit.collapsed; this._rs = !ws.rightSplit.collapsed; ws.leftSplit.collapse(); ws.rightSplit.collapse(); }
    else { if (this._ls) ws.leftSplit.expand(); if (this._rs) ws.rightSplit.expand(); }
  }
  // Leaves are left in place on unload (Obsidian guideline) so the tab comes back where the user put it after an update.
  // three.js stamps window.__THREE__ on import and warns "Multiple instances" if it is already set,
  // which happens every time the plugin is disabled and enabled again (or updated). Clear it on the way out.
  onunload() { document.body.classList.remove("nebula-focus"); delete window.__THREE__; }
}
