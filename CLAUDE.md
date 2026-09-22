# vim-mdslides

Vim/Neovim plugin that renders the current markdown buffer as a live
reveal.js slide deck in the browser — one slide per heading.

## Architecture

- `plugin/mdslides.vim` — defines `:MDSlidesStart` / `:MDSlidesStop` /
  `:MDSlidesToggle`, thin wrappers around `autoload/mdslides.vim`.
- `autoload/mdslides.vim` — spawns `app/server.js` as a background job
  (`+job`/`+channel` on Vim, `jobstart` on Neovim), writes the buffer to a
  tempfile, and re-writes it on `TextChanged`/`BufWritePost` so the server
  can pick up edits. Owns the vim-side process lifecycle.
- `app/server.js` — local HTTP server. Watches the tempfile, serves
  `app/page.html`, and pushes live updates to the browser.
- `app/render.js` — converts the markdown buffer into reveal.js slide HTML
  (splits on headings, feeds markdown-it, wires up KaTeX/Mermaid/highlight).
- `app/vendor/` — vendored third-party JS/CSS/fonts (reveal.js, markdown-it,
  KaTeX, mermaid, highlight.js). Do not hand-edit; replace wholesale if
  upgrading a version.
- `SPECS.md` — checklist of implemented vs. planned features. Update it
  when a checklist item is completed or a new one is intentionally added —
  don't let it drift from what the code actually does.

## Conventions

- No build step and no test suite. `node` is the only runtime dependency;
  keep `app/*.js` plain Node with no npm packages beyond what's vendored.
- The deck is strictly linear (one heading = one slide, forward/back only).
  Don't reintroduce grid/2D navigation — that was deliberately removed.
- Oversized slide content should scale down to fit, never scroll or clip.
  Per SPECS.md this is a known-broken area — verify in an actual browser
  (`:MDSlidesStart` against `example.md`) before claiming a fix works.
- Vim script changes must work on both Vim (`+job`/`+channel`) and Neovim —
  check `has('nvim')` branches in `autoload/mdslides.vim` stay in sync.

## Verifying changes

There's no automated test suite. To check a change:
1. Open `example.md` (or another markdown file with headings, math, a
   mermaid block, and an image) in Vim/Neovim with this plugin loaded.
2. Run `:MDSlidesStart`, confirm the browser opens and renders correctly.
3. Edit and save the buffer, confirm the deck live-updates.
4. Run `:MDSlidesStop` and confirm the node process exits.

## Rules

- Do not commit or push anything unless you are told to.
