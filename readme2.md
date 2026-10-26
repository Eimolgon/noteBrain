# Vault Workbench

A lightweight, local-first Markdown notes application. Markdown files remain the source of truth; the app uses Python's standard-library HTTP server and CodeMirror 5 in the browser.

## Requirements

- Python 3.9 or newer (standard library only for the server).
- A modern browser.
- Internet access on first use for the current CDN-hosted CodeMirror, Marked and MathJax assets. Offline use requires downloading/bundling those assets locally.
- Optional: [Pandoc](https://pandoc.org/installing.html) for PDF export, plus a PDF engine such as a LaTeX distribution. The app reports a clear error if Pandoc or the PDF engine is unavailable.

## Run

From the vault root (the directory containing `app/`, `templates/`, and your note folders):

```bash
python app/server.py
```

Open <http://127.0.0.1:8765>. Override the port with `NOTES_PORT`, for example `NOTES_PORT=9000 python app/server.py` on Linux/macOS, or `$env:NOTES_PORT=9000; python app/server.py` in PowerShell.

## Platform notes

- **Linux:** install Python 3 and optionally Pandoc and a PDF engine using your distribution's package manager.
- **macOS:** use the system package manager or official Python/Pandoc installers.
- **Windows:** install Python and optionally Pandoc using the official installers; run the command above in PowerShell from the vault root.

The server binds to `127.0.0.1` and is intended for local use. Do not expose it to an untrusted network without adding authentication and additional security controls. Back up your vault before running bulk file-generation commands.

## Editor and keyboard shortcuts

- `Ctrl+S` / `Cmd+S`: save the active note.
- `Alt+Z`: toggle Zen mode.
- `Alt+T`: toggle typewriter mode.
- `Alt+S`: cycle Standard, Code and Text editor styles.
- `Alt+H`: open shortcut help.
- Zen, typewriter, style and help shortcuts can be changed in **Settings** (single-letter Alt shortcuts). Save remains Ctrl/Cmd+S.
- Vim keybindings are enabled in CodeMirror and are preserved.

Settings for palette, editor font size, line numbers, wrapping and shortcuts are stored in browser local storage.

## PDF export

Use the PDF icon to export the active editor contents, including unsaved changes. Install Pandoc and a compatible PDF engine (commonly LaTeX) and ensure they are available on `PATH`. The generated PDF is downloaded by the browser; it is not written into the vault automatically.

## Desktop wrapper

A desktop wrapper is intentionally not included yet: the browser-based app remains portable and dependency-light. A wrapper can be evaluated separately after the browser workflow and packaging are stable.
