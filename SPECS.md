z SPECS

- [x] `:MDSlidesStart` renders the current markdown buffer as slides and opens it in the browser
- [x] `:MDSlidesStop` stops the presentation server
- [x] `:MDSlidesToggle` toggles between start and stop
- [x] Every heading (`#`-`######`) starts a new slide
- [x] Deck is strictly linear (space/→ forward, ← back), no grid navigation
- [x] Live-updates in the browser on buffer edit/save, no manual refresh
- [x] Oversized slide content auto-scales down to fit, never scrolls or clips
- [x] LaTeX math (`$inline$` and `$$block$$`), rendered server-side with KaTeX
- [x] Mermaid diagrams via ` ```mermaid ` fenced code blocks
- [x] Relative image paths resolve against the markdown file's directory
- [x] Works with both Vim (`+job`/`+channel`) and Neovim
- [x] Optional cursor-follow mode (`g:mdslides_follow_cursor`): moving the cursor jumps the browser to that slide
- [ ] Code block syntax highlighting
- [ ] Slide numbering / progress indicator
- [x] Hierarchical tree of the slides on the side. It should be able to hidden or shown during the presentation.
- [ ] There is a feature similar to the side-outline, but the outline should replace the whole slide when shown.
- [o] When the user presses '?' in the presentation, they should see a list of the key bindings that they can use during thepresentation.
