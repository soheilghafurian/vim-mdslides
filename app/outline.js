'use strict';

// Shared outline/fold UI, used by both slide mode (page.html) and document
// mode (document.html). Everything here is Reveal-agnostic: it talks only
// to `window.mdslidesDeck`, a small adapter each template assigns before
// loading this file:
//
//   gotoIndex(index)       -- jump/scroll to outline item `index`
//   getCurrentIndex()      -- currently active outline index
//   onPositionChanged(fn)  -- fn() called whenever the current index may have changed
//   getTotalCount()        -- total outline entries, for goto-SSE bounds checks
//
// Each template also assigns `window.mdslidesOutlineData` (the initial
// __OUTLINE__ payload) and `window.mdslidesInitialIndex` (__INITIAL_INDEX__)
// before loading this file, since this is a static file and can't contain
// server-side template placeholders itself.
//
// Call initOutline() once the page/deck is ready to inject the outline
// panel markup and wire everything up.

(function () {
  const deck = window.mdslidesDeck;

  // Hierarchical outline/tree panel listing every heading, indented by
  // level, so the presenter can jump straight to a slide. Toggled via the
  // on-screen button or the "0" key; rebuilt whenever the deck updates
  // (headings may have been added/removed/retitled) or the position
  // changes (to keep the "current" highlight in sync).
  let outline = window.mdslidesOutlineData || [];

  const OUTLINE_MARKUP = `
<button id="mdslides-outline-toggle" title="Toggle outline (0)">&#9776;</button>
<button id="mdslides-outline-full-toggle" title="Toggle full-page outline (9)">&#8862;</button>
<nav id="mdslides-outline"></nav>
<nav id="mdslides-outline-full" hidden></nav>
<div id="mdslides-outline-full-help" hidden>
  <div class="box">
    <p class="title">Full-page outline shortcuts</p>
    <table>
      <tr><td>j, &#8595;</td><td>Move down</td></tr>
      <tr><td>k, &#8593;</td><td>Move up</td></tr>
      <tr><td>Enter</td><td>Jump to slide</td></tr>
      <tr><td>zo / zc / za</td><td>Open / close / toggle fold</td></tr>
      <tr><td>zO / zC / zA</td><td>Open / close / toggle fold, recursively</td></tr>
      <tr><td>zj / zk</td><td>Jump to next / previous foldable node</td></tr>
      <tr><td>zr / zm</td><td>Open / close one more level everywhere</td></tr>
      <tr><td>zR / zM</td><td>Open / close all folds</td></tr>
      <tr><td>zi</td><td>Toggle folding on/off</td></tr>
      <tr><td>zn / zN</td><td>Folding off / on</td></tr>
      <tr><td>zv / zx / zX</td><td>Reveal the current slide</td></tr>
      <tr><td>?</td><td>Toggle this help</td></tr>
      <tr><td>Esc, 9</td><td>Close outline</td></tr>
    </table>
  </div>
</div>`;

  document.body.insertAdjacentHTML('beforeend', OUTLINE_MARKUP);

  const outlineEl = document.getElementById('mdslides-outline');
  const outlineToggleEl = document.getElementById('mdslides-outline-toggle');

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function renderOutline() {
    outlineEl.innerHTML = outline
      .map((item) => {
        const indent = 8 + Math.max(0, item.level - 1) * 14;
        return `<a href="#" data-index="${item.index}" style="padding-left:${indent}px">${escapeHtml(item.text)}</a>`;
      })
      .join('');
    updateOutlineCurrent();
  }

  function updateOutlineCurrent() {
    const current = deck.getCurrentIndex();
    outlineEl.querySelectorAll('a').forEach((a) => {
      a.classList.toggle('current', Number(a.dataset.index) === current);
    });
  }

  outlineEl.addEventListener('click', (ev) => {
    const a = ev.target.closest('a');
    if (!a) return;
    ev.preventDefault();
    deck.gotoIndex(Number(a.dataset.index));
  });

  function setOutlineVisible(visible) {
    outlineEl.classList.toggle('visible', visible);
    // Mutually exclusive with the full-page outline -- only one overlay at
    // a time. setOutlineFullVisible(false) only touches the full outline
    // (it doesn't call back into here), so this can't recurse.
    if (visible) setOutlineFullVisible(false);
  }

  outlineToggleEl.addEventListener('click', () => {
    setOutlineVisible(!outlineEl.classList.contains('visible'));
  });

  // Full-page outline: the same heading list as the side drawer, but as a
  // full-viewport view replacing the slide entirely -- easier to scan on a
  // long deck. It's a self-contained little modal: arrow keys/j/k move a
  // "focused" row, Enter jumps to it, Escape/9/click-outside-a-link close
  // it. While open, a capturing keydown listener swallows every key before
  // Reveal's own (bubbling) keyboard handler sees it (slide mode only --
  // document mode has no such handler to worry about), so things like
  // arrow navigation or "o" (overview) don't also act on the hidden slide
  // underneath.
  const outlineFullEl = document.getElementById('mdslides-outline-full');
  const outlineFullToggleEl = document.getElementById('mdslides-outline-full-toggle');
  const outlineHelpEl = document.getElementById('mdslides-outline-full-help');
  let fullFocusIndex = 0;
  // Slide indices (item.index) of currently-folded nodes, vim-fold style:
  // a folded node's own row stays visible, only its descendants hide.
  const folded = new Set();
  // "foldenable" (zi/zn/zN): when off, every row shows regardless of
  // `folded`, without discarding it -- turning it back on restores exactly
  // what was folded before.
  let foldingEnabled = true;
  // Coarse global depth used only by zm/zr/zM/zR: level > foldLevel means
  // "closed". Manual per-node commands (zo/zc/za/zO/zC/zA) mutate `folded`
  // directly and don't keep this in sync, so it's just a baseline for the
  // *next* zm/zr nudge, not a live reflection of the current fold state.
  let foldLevel = Infinity;
  // outline, annotated with whether each item has children -- rebuilt by
  // renderOutlineFull() each render, read by the fold commands to know
  // whether a node is foldable at all.
  let annotated = [];

  // Builds an ASCII tree-connector prefix ("|   ", "+-- ", "`-- ") for each
  // row, the same way a file-tree view draws ancestry: for every ancestor
  // depth shallower than this row's own level, a "|" continues only if
  // that ancestor still has a later child somewhere below; the row's own
  // depth gets an elbow ("+--" if it has following siblings, "`--" if
  // it's the last one). Root-level headings (level <= 1) get no prefix.
  function computeTreeGuides(items) {
    // Is there a later item at exactly `depth`, before the branch closes
    // (a later item shallower than `depth` ends it first)?
    function continuesAt(fromIndex, depth) {
      for (let j = fromIndex + 1; j < items.length; j++) {
        if (items[j].level < depth) return false;
        if (items[j].level === depth) return true;
      }
      return false;
    }

    return items.map((item, i) => {
      if (item.level <= 1) return '';
      let prefix = '';
      for (let d = 2; d < item.level; d++) {
        prefix += continuesAt(i, d) ? '│   ' : '    ';
      }
      prefix += continuesAt(i, item.level) ? '├── ' : '└── ';
      return prefix;
    });
  }

  // Tags each outline item with whether it has children (the next item is
  // deeper than it), independent of fold state -- fold commands need this
  // to know whether a node is foldable at all, and rendering needs it to
  // show a marker even for currently-empty-looking folded nodes.
  function annotateHasChildren(items) {
    return items.map((item, i) => ({
      ...item,
      hasChildren: i + 1 < items.length && items[i + 1].level > item.level,
    }));
  }

  // Filters `items` (already annotated) down to the rows a vim-style fold
  // would leave visible: once a folded node is hit, everything deeper than
  // it is skipped until a row at its own level (or shallower) closes that
  // branch back out.
  function computeVisibleOutline(items) {
    if (!foldingEnabled) return items.slice();
    const visible = [];
    let hideBelowLevel = null;
    for (const item of items) {
      if (hideBelowLevel !== null && item.level > hideBelowLevel) continue;
      hideBelowLevel = null;
      visible.push(item);
      if (item.hasChildren && folded.has(item.index)) {
        hideBelowLevel = item.level;
      }
    }
    return visible;
  }

  // Rebuilds the full-outline's rows from `outline` + the current `folded`
  // set. Doesn't touch which row is focused -- callers that want focus
  // moved (opening the panel, following the current position, undoing a
  // fold) do that explicitly via focusRowForSlideIndex() afterwards.
  function renderOutlineFull() {
    annotated = annotateHasChildren(outline);
    const visible = computeVisibleOutline(annotated);
    const guides = computeTreeGuides(visible);
    outlineFullEl.innerHTML = visible
      .map((item, i) => {
        const marker = item.hasChildren ? (folded.has(item.index) ? '▸ ' : '▾ ') : '  ';
        const guide = `<span class="tree-guides">${marker}${guides[i]}</span>`;
        const foldable = item.hasChildren ? ' data-foldable="1"' : '';
        return `<a href="#" data-index="${item.index}" data-level="${item.level}"${foldable}>${guide}<span class="tree-label">${escapeHtml(item.text)}</span></a>`;
      })
      .join('');
    applyFullOutlineRowClasses();
  }

  // Re-applies "current" (the item the deck/scroll position is actually
  // on) and "focused" (keyboard-navigation position) classes to whatever's
  // currently rendered, without rebuilding or moving focus.
  function applyFullOutlineRowClasses() {
    const items = outlineFullEl.querySelectorAll('a');
    if (fullFocusIndex >= items.length) fullFocusIndex = Math.max(0, items.length - 1);
    const current = deck.getCurrentIndex();
    items.forEach((a, i) => {
      a.classList.toggle('current', Number(a.dataset.index) === current);
      a.classList.toggle('focused', i === fullFocusIndex);
    });
  }

  // Moves keyboard focus to whichever visible row shows the given index
  // (a no-op, safely, if that item isn't currently visible -- e.g. its
  // ancestor is folded).
  function focusRowForSlideIndex(slideIndex) {
    const items = Array.from(outlineFullEl.querySelectorAll('a'));
    const idx = items.findIndex((a) => Number(a.dataset.index) === slideIndex);
    if (idx !== -1) fullFocusIndex = idx;
    applyFullOutlineRowClasses();
  }

  function getFocusedSlideIndex() {
    const a = outlineFullEl.querySelectorAll('a')[fullFocusIndex];
    return a ? Number(a.dataset.index) : null;
  }

  function moveFullFocus(delta) {
    const items = outlineFullEl.querySelectorAll('a');
    if (!items.length) return;
    fullFocusIndex = (fullFocusIndex + delta + items.length) % items.length;
    items.forEach((a, i) => a.classList.toggle('focused', i === fullFocusIndex));
    items[fullFocusIndex].scrollIntoView({ block: 'nearest' });
  }

  // zj/zk: like moveFullFocus, but skips to the next/previous *foldable*
  // row instead of the next/previous visible row -- for jumping between
  // branches in a long deck instead of stepping through every heading.
  function moveFullFocusToFoldable(delta) {
    const items = Array.from(outlineFullEl.querySelectorAll('a'));
    const foldableIndices = items.reduce((acc, a, i) => {
      if (a.dataset.foldable === '1') acc.push(i);
      return acc;
    }, []);
    if (!foldableIndices.length) return;
    const ahead = delta > 0
      ? foldableIndices.filter((i) => i > fullFocusIndex)
      : foldableIndices.filter((i) => i < fullFocusIndex).reverse();
    fullFocusIndex = ahead.length
      ? ahead[0]
      : (delta > 0 ? foldableIndices[0] : foldableIndices[foldableIndices.length - 1]);
    items.forEach((a, i) => a.classList.toggle('focused', i === fullFocusIndex));
    items[fullFocusIndex].scrollIntoView({ block: 'nearest' });
  }

  // All descendants of `item` (every later item in `annotated` deeper than
  // it, stopping at the first one back down to its own level or shallower)
  // -- used by the recursive fold commands (zO/zC/zA).
  function descendantsOf(item) {
    const i = annotated.findIndex((it) => it.index === item.index);
    const result = [];
    for (let j = i + 1; j < annotated.length; j++) {
      if (annotated[j].level <= item.level) break;
      result.push(annotated[j]);
    }
    return result;
  }

  // Vim-style folding, scoped to the focused row. A plain fold only hides
  // a node's descendants -- the node's own row stays put, so refocusing it
  // by slide index after a re-render always succeeds.
  function setFold(slideIndex, shouldFold) {
    if (slideIndex === null) return;
    const item = annotated.find((it) => it.index === slideIndex);
    if (!item || !item.hasChildren) return;
    if (shouldFold) folded.add(slideIndex); else folded.delete(slideIndex);
    renderOutlineFull();
    focusRowForSlideIndex(slideIndex);
  }

  // zO/zC/zA: same as zo/zc/za, but also forces every descendant fold (not
  // just the immediate node) to the same open/closed state.
  function setFoldRecursive(slideIndex, shouldFold) {
    if (slideIndex === null) return;
    const item = annotated.find((it) => it.index === slideIndex);
    if (!item || !item.hasChildren) return;
    const targets = [item, ...descendantsOf(item).filter((d) => d.hasChildren)];
    targets.forEach((t) => {
      if (shouldFold) folded.add(t.index); else folded.delete(t.index);
    });
    renderOutlineFull();
    focusRowForSlideIndex(slideIndex);
  }

  function foldAll() {
    const slideIndex = getFocusedSlideIndex();
    annotated.forEach((item) => {
      if (item.hasChildren) folded.add(item.index);
    });
    renderOutlineFull();
    if (slideIndex !== null) focusRowForSlideIndex(slideIndex);
  }

  function unfoldAll() {
    const slideIndex = getFocusedSlideIndex();
    folded.clear();
    renderOutlineFull();
    if (slideIndex !== null) focusRowForSlideIndex(slideIndex);
  }

  // The deepest heading level that actually owns a fold (has children) --
  // used as the "fully open" baseline for zm/zr's first step. Using the
  // deepest heading level overall would be wrong: the deepest heading
  // never has children (nothing is deeper than it), so it never defines a
  // fold at all -- stepping toward *that* would be a no-op every time.
  function maxFoldableLevel() {
    return annotated.reduce((max, item) => (item.hasChildren ? Math.max(max, item.level) : max), 0);
  }

  // zm/zr/zM/zR: a coarse global "depth" -- every foldable node deeper
  // than `level` gets closed, everything at or above it opens. This
  // replaces whatever `folded` held before, same as vim discarding manual
  // fold state when 'foldlevel' changes.
  function applyFoldLevel(level) {
    const slideIndex = getFocusedSlideIndex();
    foldLevel = level;
    folded.clear();
    annotated.forEach((item) => {
      if (item.hasChildren && item.level > level) folded.add(item.index);
    });
    renderOutlineFull();
    if (slideIndex !== null) focusRowForSlideIndex(slideIndex);
  }

  // zv/zx/zX: our tree is always derived fresh from the current headings
  // (nothing to recompute the way vim's foldmethod would), so all three
  // reduce to the same useful thing here -- unfold whatever's hiding the
  // item the deck/scroll position is actually on, without touching any
  // other fold.
  function revealCurrentSlide() {
    const currentSlideIndex = deck.getCurrentIndex();
    const i = annotated.findIndex((it) => it.index === currentSlideIndex);
    if (i === -1) return;
    let level = annotated[i].level;
    for (let j = i - 1; j >= 0 && level > 1; j--) {
      if (annotated[j].level < level) {
        folded.delete(annotated[j].index);
        level = annotated[j].level;
      }
    }
    renderOutlineFull();
    focusRowForSlideIndex(currentSlideIndex);
  }

  function applyFoldCommand(cmd) {
    const slideIndex = getFocusedSlideIndex();
    const isFolded = slideIndex !== null && folded.has(slideIndex);
    if (cmd === 'zo') setFold(slideIndex, false);
    else if (cmd === 'zc') setFold(slideIndex, true);
    else if (cmd === 'za') setFold(slideIndex, !isFolded);
    else if (cmd === 'zO') setFoldRecursive(slideIndex, false);
    else if (cmd === 'zC') setFoldRecursive(slideIndex, true);
    else if (cmd === 'zA') setFoldRecursive(slideIndex, !isFolded);
    else if (cmd === 'zR') applyFoldLevel(Infinity);
    else if (cmd === 'zM') applyFoldLevel(0);
    else if (cmd === 'zr') applyFoldLevel(Math.min(maxFoldableLevel(), (foldLevel === Infinity ? maxFoldableLevel() : foldLevel) + 1));
    else if (cmd === 'zm') applyFoldLevel(Math.max(0, (foldLevel === Infinity ? maxFoldableLevel() : foldLevel) - 1));
    else if (cmd === 'zi') { foldingEnabled = !foldingEnabled; renderOutlineFull(); }
    else if (cmd === 'zn') { foldingEnabled = false; renderOutlineFull(); }
    else if (cmd === 'zN') { foldingEnabled = true; renderOutlineFull(); }
    else if (cmd === 'zv' || cmd === 'zx' || cmd === 'zX') revealCurrentSlide();
    else if (cmd === 'zj') moveFullFocusToFoldable(1);
    else if (cmd === 'zk') moveFullFocusToFoldable(-1);
  }

  function isOutlineFullVisible() {
    return !outlineFullEl.hidden;
  }

  function setOutlineHelpVisible(visible) {
    outlineHelpEl.hidden = !visible;
  }

  function setOutlineFullVisible(visible) {
    outlineFullEl.hidden = !visible;
    if (visible) {
      setOutlineVisible(false);
      focusRowForSlideIndex(deck.getCurrentIndex());
    } else {
      setOutlineHelpVisible(false);
    }
  }

  outlineFullEl.addEventListener('click', (ev) => {
    const a = ev.target.closest('a');
    if (!a) return;
    ev.preventDefault();
    deck.gotoIndex(Number(a.dataset.index));
    setOutlineFullVisible(false);
  });

  outlineFullToggleEl.addEventListener('click', () => {
    setOutlineFullVisible(!isOutlineFullVisible());
  });

  // Pressing "z" arms a two-key fold command (zo/zc/za/zR/zM, mirroring
  // vim); whatever key follows completes or cancels it. Otherwise, this
  // (registered on the capture phase) is what makes the full outline its
  // own little modal: while it's open, every key is handled here and
  // never reaches any other keyboard handler underneath -- that's also why
  // "?" opens *this* panel's shortcut list instead of Reveal's global one
  // in slide mode.
  // Bare modifier keys (held to type a capital letter for zO/zC/zA/zR/zM/
  // zN/zX) fire their own keydown *before* the letter's -- e.g. pressing
  // Shift+O fires one keydown for "Shift" and then a separate one for "O".
  // Without this guard, the "Shift" keydown itself would get consumed as
  // the second half of a "z" command, leaving nothing to catch the actual
  // letter that follows.
  const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'OS']);
  let pendingFoldPrefix = false;
  document.addEventListener('keydown', (ev) => {
    if (!isOutlineFullVisible()) {
      // The side drawer's own toggle ("0") and the full outline's open key
      // ("9") work even when the full outline itself isn't open yet.
      if (ev.key === '0') {
        setOutlineVisible(!outlineEl.classList.contains('visible'));
        ev.preventDefault();
        ev.stopPropagation();
      } else if (ev.key === '9') {
        setOutlineFullVisible(true);
        ev.preventDefault();
        ev.stopPropagation();
      }
      return;
    }
    if (MODIFIER_KEYS.has(ev.key)) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    // OS-level key repeat (holding a key down, even briefly) fires several
    // keydown events for what feels like one press. For one-shot actions
    // like closing a panel that's a real problem: the first repeat closes
    // the help overlay, a second one (now that it's closed) closes the
    // whole outline too, and a third slips through once we've stopped
    // intercepting at all. Swallow repeats outright rather than acting on
    // them again.
    if (ev.repeat) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    if (pendingFoldPrefix) {
      pendingFoldPrefix = false;
      applyFoldCommand('z' + ev.key);
    } else if (!outlineHelpEl.hidden) {
      if (ev.key === 'Escape' || ev.key === '?') setOutlineHelpVisible(false);
    } else if (ev.key === 'z') {
      pendingFoldPrefix = true;
    } else if (ev.key === '?') {
      setOutlineHelpVisible(true);
    } else if (ev.key === 'Escape' || ev.key === '9') {
      setOutlineFullVisible(false);
    } else if (ev.key === 'ArrowDown' || ev.key === 'j') {
      moveFullFocus(1);
    } else if (ev.key === 'ArrowUp' || ev.key === 'k') {
      moveFullFocus(-1);
    } else if (ev.key === 'Enter') {
      const focused = outlineFullEl.querySelectorAll('a')[fullFocusIndex];
      if (focused) deck.gotoIndex(Number(focused.dataset.index));
      setOutlineFullVisible(false);
    }
    ev.preventDefault();
    ev.stopPropagation();
  }, true);

  deck.onPositionChanged(() => {
    updateOutlineCurrent();
    focusRowForSlideIndex(deck.getCurrentIndex());
  });

  window.mdslidesOutline = {
    init() {
      renderOutline();
      renderOutlineFull();
    },
    refresh(newOutline) {
      outline = newOutline;
      renderOutline();
      renderOutlineFull();
    },
  };
})();
