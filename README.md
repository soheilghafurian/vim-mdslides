# vim-mdslides

Turn the current markdown buffer into a live reveal.js presentation in your
browser, one slide per heading — like `:MarkdownPreview`, but for slides.

## Requirements

- Vim or Neovim with `+job`/`+channel` support (or Neovim, which always has it)
- `node` on your `$PATH`
- `curl` on your `$PATH`, only if you enable `g:mdslides_follow_cursor`

## Install (Vundle)

```vim
Plugin 'soheilghafurian/vim-mdslides'
```

## Usage

- `:MDSlidesStart` — render the current markdown buffer as slides and open
  it in your browser. Every heading, at any level (`#` through `######`),
  starts a new slide. The deck live-updates in the browser as you edit and
  save, without a manual refresh.
- `:MDSlidesStop` — stop the presentation server.
- `:MDSlidesToggle` — toggle between the two.

The deck is strictly linear — space / → to move forward, ← to go back.
There's no grid of slides going in two directions to navigate.

If a slide's content doesn't fit, everything on it (text, images, diagrams)
is scaled down together until it does. Nothing scrolls or gets clipped; if
it shrinks to the point of being unreadable, that's a sign to trim the
slide's content, not something mdslides fixes for you.

### Preview mode

- `:MDPreviewStart` — render the current markdown buffer as a plain,
  continuous, normally-scrolling document instead of a slide deck — the
  same live-updating, math/mermaid/image support, but not split into
  slides.
- `:MDPreviewStop` — stop the preview server.
- `:MDPreviewToggle` — toggle preview mode; if slide mode is currently
  running for this buffer, this switches to preview instead of just
  stopping it.

Only one session (either mode) runs at a time — starting either one stops
whatever's currently running.

### Outline / navigation

Both modes share the same outline UI: press `0` for a side drawer listing
every heading, or `9` for a full-page, foldable tree view of the whole
document (vim-style `zo`/`zc`/`za`/`zR`/`zM`/etc. folding — press `?`
inside it for the full list of keys). Click any entry, or a slide/heading
index, to jump straight to it.

Also supported, same as a regular markdown file:

- **LaTeX math** — `$inline$` and `$$block$$` math, rendered server-side with KaTeX.
- **Mermaid diagrams** — ` ```mermaid ` fenced code blocks render as live diagrams.
- **Images** — relative image paths resolve against the markdown file's own
  directory, e.g. `![alt](images/foo.png)`.

See `example.md` in this repo for a working demo of all of the above.

Suggested mapping, mirroring the `:M` alias for `:MarkdownPreview`:

```vim
autocmd FileType markdown command! -buffer P MDSlidesToggle
```

## Config

```vim
let g:mdslides_port = 0               " local server port, 0 = pick one automatically
let g:mdslides_open_browser_cmd = 'xdg-open'  " override the browser-open command
let g:mdslides_follow_cursor = 0      " 1 = jump to whatever slide the cursor is under
```

`g:mdslides_follow_cursor` makes the cursor the sole driver of slide
position: moving it in the buffer jumps the browser to that slide, but that
also means manual arrow-key navigation in the browser gets overridden on the
next cursor move. It's off by default for that reason, and requires `curl`
on your `$PATH`.
