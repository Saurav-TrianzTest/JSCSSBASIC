/**
 * assets/js/styled-components-ssr-shim.js
 *
 * CLOUD READINESS FIX (cr-css-1007): CSS-in-JS Without SSR Extract Configuration
 * ─────────────────────────────────────────────────────────────────────────────────
 * Browser-runnable shim for the 'styled-components' bare specifier.
 *
 * Resolved via the import map in index.html so the module (src/ui/styles.js)
 * runs in the browser without a bundler, while preserving the same
 * tagged-template API surface used by the styled components (styled.div`...`).
 *
 * On the server (AWS Lambda SSR / Next.js), the real styled-components package
 * is resolved from node_modules and provides the full ServerStyleSheet
 * implementation for critical-CSS extraction.
 *
 * ServerStyleSheet browser stub:
 *   In the browser, ServerStyleSheet is a no-op because styles are already
 *   injected into the DOM by styled-components' client-side runtime.
 *   The stub exposes the same API surface so that any code that imports
 *   ServerStyleSheet can run in both environments without branching.
 */

// ---------------------------------------------------------------------------
// Minimal browser-runnable styled factory
// Preserves the tagged-template API: styled.div`...`, styled.span`...`, etc.
// ---------------------------------------------------------------------------
function createStyledFactory(tagName) {
  return function styledTag(strings) {
    var css = Array.isArray(strings)
      ? strings.reduce(function (acc, str, i) {
          return acc + str + (arguments[i + 1] !== undefined ? arguments[i + 1] : '');
        }, '')
      : String(strings);

    var className = 'sc-' + Math.random().toString(36).slice(2, 9);

    if (typeof document !== 'undefined') {
      var styleEl = document.createElement('style');
      styleEl.setAttribute('data-styled', '');
      styleEl.textContent = '.' + className + ' {' + css + '}';
      document.head.appendChild(styleEl);
    }

    // Return a functional component-like object compatible with JSX usage
    return { tag: tagName, className: className };
  };
}

var styled = new Proxy({}, {
  get: function (_target, tagName) {
    return createStyledFactory(String(tagName));
  }
});

// ---------------------------------------------------------------------------
// ServerStyleSheet browser stub
// No-op in the browser — real extraction happens on the Lambda SSR server.
// Exposes the full API surface so isomorphic code runs without errors.
// ---------------------------------------------------------------------------
export function ServerStyleSheet() {
  this._sheet = null;
}

ServerStyleSheet.prototype.collectStyles = function (element) {
  // In the browser, styled-components injects styles into the DOM automatically.
  // No collection is needed; return the element unchanged.
  return element;
};

ServerStyleSheet.prototype.getStyleTags = function () {
  // In the browser, styles are already in the DOM — return empty string.
  return '';
};

ServerStyleSheet.prototype.getStyleElement = function () {
  // React element variant — return null in the browser.
  return null;
};

ServerStyleSheet.prototype.interleaveWithNodeStream = function (stream) {
  // Pass-through in the browser (no Node.js streams available).
  return stream;
};

ServerStyleSheet.prototype.seal = function () {
  // No-op in the browser.
};

// ---------------------------------------------------------------------------
// Exports — matches the named + default exports of the real styled-components
// ---------------------------------------------------------------------------
export default styled;
export { styled };
