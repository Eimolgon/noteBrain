# noteBrain

**noteBrain** is a local-first Markdown note-taking app with Zettelkasten-style links, backlinks, and a connected-notes graph. Your Markdown files remain the source of truth; the app does not require a database or internet connection.

## Requirements

- Python 3.9 or newer
- A modern web browser
- Optional for PDF export: Pandoc and a compatible PDF engine (for example, LaTeX)

The browser libraries and fonts are bundled locally. No package manager or internet connection is required at runtime.

## Run

From the repository directory containing `app/`, `templates/`, and your note folders:

```bash
python app/server.py
```

Open <http://127.0.0.1:8765>. To use another port, set `NOTES_PORT` before starting the server, for example `NOTES_PORT=9000 python app/server.py` on Linux/macOS or `$env:NOTES_PORT=9000; python app/server.py` in PowerShell.

## Features

- Markdown editor with Vim keybindings, preview, search, and metadata filters
- `[[wiki links]]`, local Markdown links, backlinks, and generated backlink sections
- Global and current-note graph views
- Note templates, references/BibTeX collection, index generation, and optional PDF export
- Customizable editor appearance and keyboard shortcuts
- Offline frontend assets and local-only server binding

Backlink sections are generated between `<!-- AUTO-BACKLINKS:START -->` and `<!-- AUTO-BACKLINKS:END -->`. Do not edit the contents inside these markers; saving or reindexing regenerates them. Backlinks and graph relationships are derived from wiki links (`[[...]]`).

## Tests

Run the standard-library test suite from the repository directory:

```bash
python -m unittest discover -s tests -v
```

## Data and security notes

Back up your notes before running bulk operations. The server binds to `127.0.0.1` and is intended for local use; do not expose it to an untrusted network without adding authentication and further security controls. PDF export requires the optional local tools noted above.
