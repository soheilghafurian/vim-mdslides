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

// Walk the token stream and cut it into slides. A heading whose level is
// <= slideLevel starts a new horizontal slide; a heading deeper than that
// starts a new vertical (nested) slide under the current horizontal one.
function splitIntoSlides(tokens, slideLevel) {
  const horizontals = [[]]; // array of vertical-slide arrays of tokens
  let current = horizontals[0];
  let verticals = [current];
  horizontals[0] = verticals;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'heading_open') {
      const level = Number(tok.tag.slice(1)); // 'h1' -> 1
      if (level <= slideLevel) {
        verticals = [[]];
        horizontals.push(verticals);
        current = verticals[0];
      } else {
        current = [];
        verticals.push(current);
      }
    }
    current.push(tok);
  }

  // Drop the empty slide that precedes the very first heading, if any.
  if (horizontals.length > 1 && horizontals[0][0].length === 0) {
    horizontals.shift();
  }

  return horizontals;
}

function renderSlidesHtml(markdownSource, slideLevel) {
  const stashed = stashMath(markdownSource);
  const tokens = md.parse(stashed, {});
  const horizontals = splitIntoSlides(tokens, slideLevel);

  const sectionsHtml = horizontals
    .map((verticals) => {
      const verticalSections = verticals
        .map((slideTokens) => `<section>${md.renderer.render(slideTokens, md.options, {})}</section>`)
        .join('\n');
      return verticals.length > 1 ? `<section>\n${verticalSections}\n</section>` : verticalSections;
    })
    .join('\n');

  const html = sectionsHtml || '<section><h1>Empty presentation</h1></section>';
  return unstashMath(html);
}

module.exports = { renderSlidesHtml };
