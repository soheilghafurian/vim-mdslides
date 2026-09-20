# vim-mdslides

Turn the current markdown buffer into a live reveal.js presentation in your
browser, one slide per heading — like `:MarkdownPreview`, but for slides.

## Requirements

- Vim or Neovim with `+job`/`+channel` support (or Neovim, which always has it)
- `node` on your `$PATH`

## Install (Vundle)

```vim
Plugin 'soheilghafurian/vim-mdslides'
```

## Usage

- `:MDSlidesStart` — render the current markdown buffer as slides and open
  it in your browser. Every heading at or above `g:mdslides_slide_level`
  (default `1`, i.e. `#`) starts a new slide; deeper headings become
  vertical sub-slides. The deck live-updates in the browser as you edit and
  save, without a manual refresh.
- `:MDSlidesStop` — stop the presentation server.
- `:MDSlidesToggle` — toggle between the two.

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
let g:mdslides_port = 8890            " local server port
let g:mdslides_slide_level = 1        " heading level that starts a new slide
let g:mdslides_open_browser_cmd = 'xdg-open'  " override the browser-open command
```
