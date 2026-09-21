'use strict';

const path = require('path');
const MarkdownIt = require(path.join(__dirname, 'vendor', 'markdown-it.min.js'));
const katex = require(path.join(__dirname, 'vendor', 'katex.min.js'));

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

// Render fenced ```mermaid blocks as <div class="mermaid"> containers that
// the client-side mermaid.js picks up and turns into diagrams.
const defaultFenceRenderer =
  md.renderer.rules.fence ||
  function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };
md.renderer.rules.fence = function (tokens, idx, options, env, self) {
  const token = tokens[idx];
  const lang = token.info.trim().toLowerCase();
  if (lang === 'mermaid') {
    return `<div class="mermaid">${md.utils.escapeHtml(token.content)}</div>\n`;
  }
  return defaultFenceRenderer(tokens, idx, options, env, self);
};

// --- LaTeX math -------------------------------------------------------
// KaTeX is rendered server-side (no client-side math JS needed). Math spans
// are pulled out of the raw markdown *before* it reaches markdown-it (so
// things like subscripts' underscores don't get misread as emphasis
// markers), replaced with opaque placeholders, and swapped back in after
// the rest of the markdown has been rendered to HTML.
let mathPlaceholders;

function stashMath(source) {
  mathPlaceholders = [];
  const stash = (tex, displayMode) => {
    const html = katex.renderToString(tex, { throwOnError: false, displayMode });
    const key = `MATH${mathPlaceholders.length}`;
    mathPlaceholders.push(html);
    return key;
  };

  return source
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => stash(tex, true))
    .replace(/(?<![$\\])\$(?!\s)((?:\\\$|[^$])+?)(?<!\s)\$(?!\$)/g, (_, tex) => stash(tex, false));
}

function unstashMath(html) {
  return html.replace(/MATH(\d+)/g, (_, i) => mathPlaceholders[Number(i)]);
}

// Walk the token stream and cut it into slides, all in a single linear
// sequence (no vertical/nested slides -- presenting only ever goes
// forward). Every heading, at any level, starts a new slide.
function splitIntoSlides(tokens) {
  const slides = [[]];
  let current = slides[0];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'heading_open') {
      current = [];
      slides.push(current);
    }
    current.push(tok);
  }

  // Drop the empty slide that precedes the very first heading, if any.
  if (slides.length > 1 && slides[0].length === 0) {
    slides.shift();
  }

  return slides;
}

function renderSlidesHtml(markdownSource) {
  const stashed = stashMath(markdownSource);
  const tokens = md.parse(stashed, {});
  const slides = splitIntoSlides(tokens);

  // Each slide's content is wrapped in a fixed-size, unscaled
  // measurement box (.slide-fit) so the client can measure its natural
  // size and shrink it down (via CSS transform) to fit the slide if it
  // overflows -- see the fit logic in page.html.
  const sectionsHtml = slides
    .map(
      (slideTokens) =>
        `<section><div class="slide-fit">${md.renderer.render(slideTokens, md.options, {})}</div></section>`
    )
    .join('\n');

  const html = sectionsHtml || '<section><div class="slide-fit"><h1>Empty presentation</h1></div></section>';
  return unstashMath(html);
}

module.exports = { renderSlidesHtml };
