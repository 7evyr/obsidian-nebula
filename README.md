# Nebula

A glowing 3D constellation view of your Obsidian vault.

![Nebula](assets/nebula.png)

Every note is a star. Each top-level folder gets its own tilted orbit ring around a central hub, and every link between notes is drawn as a line of light, with beads of light running along it.

## Features

- Full 3D view: drag to spin, right-drag to move, scroll to zoom.
- Click a star to open that note in a split pane. Hover to see its name and folder.
- Click a folder label to fly to that ring.
- Focus mode (`F`) hides the sidebars so the view fills the window. `Esc` leaves it.
- Customize panel: color, glow, node size, link and ring brightness, light beads, spin, comets, pulse, background stars, folder names, and render quality.
- The view updates itself when notes or links change.
- The ribbon's orbit button switches between Nebula and the normal graph view.

## Install

### With BRAT (works today)

1. Install **BRAT** from Settings → Community plugins → Browse, and enable it.
2. Run the command **BRAT: Add a beta plugin for testing**.
3. Paste `7evyr/obsidian-nebula` and confirm.
4. Enable **Nebula** in Settings → Community plugins.

### By hand

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/7evyr/obsidian-nebula/releases/latest).
2. Put them in `<your vault>/.obsidian/plugins/nebula/`.
3. Reload Obsidian and enable **Nebula** in Settings → Community plugins.

## Use

Click the orbit icon in the left ribbon, or run **Nebula: Toggle view** from the command palette.

## Notes

- Desktop only for now.
- Big vaults are fine. If it feels heavy, set Quality to **Fast** in the Customize panel.
- Nebula only reads your vault's file list and links. It never changes your notes and makes no network requests.

## Build

```bash
npm install
npm run build
```

This writes `main.js` next to `manifest.json` and `styles.css`.

## License

[MIT](LICENSE). Built with [three.js](https://threejs.org) (MIT).
