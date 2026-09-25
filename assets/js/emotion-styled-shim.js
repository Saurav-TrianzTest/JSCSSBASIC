// Minimal browser-runnable shim for the '@emotion/styled' bare specifier.
// Resolved via the import map in index.html so this repo runs without a
// bundler, while preserving the same tagged-template API surface used
// by the fixture code (styled.div`...`).
//
// CLOUD REMEDIATION (cr-css-1001): CSS Injection via User-Controlled Style Values
//
// The shim now passes all generated CSS through sanitizeEmotionCss() before
// injecting it into a <style> element. This prevents CSS injection attacks
// when user-controlled values are interpolated into Emotion template literals.
//
// Remediation strategy: Sanitize CSS User Input with AWS WAF and Server-Side CSS Encoding
//   - sanitizeEmotionCss() strips javascript:/data: url() schemes, expression(),
//     and rogue @import directives from CSS-in-JS output.
//   - AWS WAF AWSManagedRulesCommonRuleSet must be enabled at the CloudFront/ALB
//     layer to block injection payloads before they reach the application.

import { sanitizeEmotionCss } from './css-sanitizer.js';

function createStyledFactory(tagName) {
  return function styledTag(strings, ...values) {
    var css = strings.reduce(function (acc, str, i) {
      return acc + str + (values[i] !== undefined ? values[i] : '');
    }, '');

    // [cr-css-1001 FIX] Sanitize the assembled CSS before DOM injection to
    // prevent CSS injection via user-controlled interpolated values.
    var safeCss = sanitizeEmotionCss(css);

    var className = 'styled-' + Math.random().toString(36).slice(2, 9);
    if (typeof document !== 'undefined') {
      var styleEl = document.createElement('style');
      styleEl.textContent = '.' + className + ' {' + safeCss + '}';
      document.head.appendChild(styleEl);
    }
    return { tag: tagName, className: className };
  };
}

var styled = new Proxy({}, {
  get: function (_target, tagName) {
    return createStyledFactory(tagName);
  }
});

export default styled;
