# SV STRATA

An interactive visual atlas of Silicon Valley as a stack of conceptual strata — a landing diagram, a per-layer node editor, and a 3D lattice that connects nodes across planes.

Vanilla HTML / CSS / JavaScript. No build step, no framework, no dependencies beyond a browser.

## Pages

- `index.html` — landing view with three glowing SV strata. Click a stratum to dive into its layer editor. Export / Import the full diagram as JSON.
- `layer.html` — per-layer editor. Pan, zoom, click to add nodes, draw connections between them, attach side notes (title, description, images, links).
- `lattice.html` — 3D lattice view. Stacked planes, cross-plane connections, can import a 2D diagram and lift it into 3D.

## Run locally

No build required. Serve the directory over HTTP (browsers won't load local files via `file://` for some features):

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Project layout

```
index.html      lattice.html     layer.html
style.css       lattice.css      layer.css
shape.js        lattice.js       editor.js
```

## Contributing

Contributions are welcome. Fork the repo, create a branch, open a pull request. For larger changes, open an issue first to discuss the direction.

This project is intentionally dependency-free — please keep it that way unless there's a compelling reason. No build tooling, no package.json, no transpilers.

## License

[MIT](LICENSE) — do whatever you want, just keep the copyright notice.
