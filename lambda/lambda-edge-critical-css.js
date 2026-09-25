'use strict';

/**
 * Lambda@Edge — Critical CSS Inline Injector
 * Rules: cr-css-1002 — Critical CSS Not Inlined for Above-Fold Content
 *        cr-css-1008 — Client-Only CSS Loaded After Hydration
 *
 * OVERVIEW:
 *   This Lambda@Edge function is associated with the CloudFront distribution as an
 *   origin-response trigger. It intercepts HTML responses from the origin, extracts
 *   the critical above-fold CSS rules from the embedded marker block in site.css,
 *   AND extracts the hydration CSS rules from client-hydration.css, then injects
 *   both as inline <style> blocks into the HTML <head>.
 *
 *   By inlining critical CSS and hydration CSS at the CloudFront edge:
 *     - The browser can render above-fold content immediately without waiting for
 *       an external CSS file to download (eliminates render-blocking request).
 *     - Hydration styles (.hydrated-widget, .ssr-hidden) are present in the
 *       server-rendered HTML, eliminating Flash of Unstyled Content (FOUC) and
 *       preventing style mismatch between SSR and client-hydrated content.
 *     - First Contentful Paint (FCP) and Largest Contentful Paint (LCP) improve.
 *     - AWS CloudFront Core Web Vitals scores improve, benefiting SEO rankings.
 *
 * DEPLOYMENT:
 *   1. Create a Lambda function in us-east-1 (required for Lambda@Edge).
 *   2. Upload this file as the function handler (index.js).
 *   3. Set the handler to "index.handler".
 *   4. Assign an execution role with:
 *        - AWSLambdaBasicExecutionRole
 *        - edgelambda.amazonaws.com as a trusted service principal
 *   5. Publish a version of the Lambda function.
 *   6. In CloudFront, add the published ARN as an origin-response trigger on the
 *      cache behavior that serves HTML pages (e.g., path pattern: /).
 *   7. Set CRITICAL_CSS_SOURCE_URL to the CloudFront URL of site.css.
 *   8. Set HYDRATION_CSS_SOURCE_URL to the CloudFront URL of client-hydration.css.
 *
 * ENVIRONMENT VARIABLES (set on the Lambda function):
 *   CRITICAL_CSS_SOURCE_URL   — CloudFront URL of assets/css/site.css
 *                               e.g. https://d1234abcd.cloudfront.net/assets/css/site.css
 *                               If not set, the bundled FALLBACK_CRITICAL_CSS is used.
 *   HYDRATION_CSS_SOURCE_URL  — CloudFront URL of assets/css/client-hydration.css
 *                               e.g. https://d1234abcd.cloudfront.net/assets/css/client-hydration.css
 *                               If not set, the bundled FALLBACK_HYDRATION_CSS is used.
 *
 * CSS MARKERS:
 *   Critical CSS (site.css):
 *     CRITICAL_CSS_INLINE_BEGIN  (start of critical rules)
 *     CRITICAL_CSS_INLINE_END    (end of critical rules)
 *
 *   Hydration CSS (client-hydration.css) — cr-css-1008 fix:
 *     HYDRATION_CSS_INLINE_BEGIN  (start of hydration rules)
 *     HYDRATION_CSS_INLINE_END    (end of hydration rules)
 *
 * CACHING:
 *   Parsed CSS is cached in the Lambda execution context (module-level variables)
 *   so subsequent invocations on the same container reuse the parsed rules without
 *   re-fetching the source files.
 *
 * SECURITY:
 *   - The injected <style> blocks use the CSP nonce placeholder {{CSP_NONCE}},
 *     which must be replaced by a separate nonce-injection Lambda@Edge function
 *     (viewer-request trigger) before the response is sent to the browser.
 *   - The function only modifies responses with Content-Type: text/html.
 *   - All other responses are passed through unchanged.
 */

const https = require('https');
const http  = require('http');

/* ─── Fallback critical CSS (cr-css-1002) ──────────────────────────────────
 * Used when CRITICAL_CSS_SOURCE_URL is not set or the fetch fails.
 * Keep this in sync with the CRITICAL_CSS_INLINE_BEGIN..END block in site.css.
 * ─────────────────────────────────────────────────────────────────────────── */
const FALLBACK_CRITICAL_CSS = `
  /* Reset & base */
  *, *::before, *::after { box-sizing: border-box; }
  html { font-size: 16px; line-height: 1.5; }
  body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #fff; color: #0a2540; }

  /* Navigation — above fold */
  .nav { display: flex; align-items: center; height: 56px; padding: 0 24px; background: #0a2540; color: #fff; }
  .nav a { color: #fff; text-decoration: none; }

  /* Hero section — above fold */
  .hero { padding: 64px 24px; text-align: center; color: var(--primary-color, #0a2540); }
  .hero h1 { font-size: 2.5rem; margin: 0 0 16px; }
  .hero p  { font-size: 1.125rem; margin: 0 0 24px; }

  /* Primary button — above fold */
  .btn-primary { display: inline-block; padding: 12px 28px; background: #0a2540; color: #fff; border-radius: 4px; text-decoration: none; font-weight: 600; }

  /* CSS custom properties needed above fold */
  :root { --primary-color: #0a2540; }
`.trim();

/* ─── Fallback hydration CSS (cr-css-1008) ──────────────────────────────────
 * Used when HYDRATION_CSS_SOURCE_URL is not set or the fetch fails.
 * Keep this in sync with the HYDRATION_CSS_INLINE_BEGIN..END block in
 * assets/css/client-hydration.css.
 *
 * These rules are inlined during SSR so they are present in the server-rendered
 * HTML, eliminating Flash of Unstyled Content (FOUC) and preventing style
 * mismatch between SSR and client-hydrated content.
 * ─────────────────────────────────────────────────────────────────────────── */
const FALLBACK_HYDRATION_CSS = `
  /* CSS custom property for hydrated colour — available during SSR */
  :root { --hydrated-color: #0a2540; }

  /* SSR initial state: hidden to prevent flash before hydration */
  .hydrated-widget {
    opacity: 0;
    transition: opacity 0.3s;
  }

  /* Post-hydration state: added by JavaScript after client hydration completes */
  .hydrated-widget.is-hydrated {
    opacity: 1;
  }

  /* Inlined for SSR: display:block present in server-rendered HTML */
  .ssr-hidden {
    display: block;
    color: var(--hydrated-color);
  }
`.trim();

/* ─── Module-level cache (survives warm Lambda invocations) ─────────────── */
let cachedCriticalCss   = null;
let cachedHydrationCss  = null;

/**
 * Fetch a URL and return the response body as a string.
 * Supports both http:// and https:// URLs.
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https://') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        res.resume();
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end',  ()      => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Extract CSS rules from a stylesheet string using named BEGIN/END markers.
 *
 * @param {string} cssText      Full content of the CSS file
 * @param {string} beginMarker  Name of the begin marker (without comment syntax)
 * @param {string} endMarker    Name of the end marker (without comment syntax)
 * @returns {string}            Extracted CSS rules, or empty string if not found
 */
function extractMarkedCss(cssText, beginMarker, endMarker) {
  const beginIdx = cssText.indexOf(beginMarker);
  const endIdx   = cssText.indexOf(endMarker);

  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
    return '';
  }

  // Slice from after the begin marker comment line to before the end marker comment line
  const afterBegin = cssText.indexOf('\n', beginIdx);
  const beforeEnd  = cssText.lastIndexOf('\n', endIdx);

  if (afterBegin === -1 || beforeEnd === -1 || beforeEnd <= afterBegin) {
    return '';
  }

  return cssText.slice(afterBegin + 1, beforeEnd).trim();
}

/**
 * Load critical CSS (cr-css-1002) — from cache, remote URL, or fallback.
 *
 * @returns {Promise<string>}
 */
async function loadCriticalCss() {
  if (cachedCriticalCss !== null) {
    return cachedCriticalCss;
  }

  const sourceUrl = process.env.CRITICAL_CSS_SOURCE_URL;

  if (sourceUrl) {
    try {
      const cssText = await fetchUrl(sourceUrl);
      const extracted = extractMarkedCss(cssText, 'CRITICAL_CSS_INLINE_BEGIN', 'CRITICAL_CSS_INLINE_END');
      if (extracted) {
        cachedCriticalCss = extracted;
        console.log('[cr-css-1002] Critical CSS extracted from remote site.css (' + extracted.length + ' bytes)');
        return cachedCriticalCss;
      }
      console.warn('[cr-css-1002] Markers not found in remote site.css — using fallback critical CSS');
    } catch (err) {
      console.error('[cr-css-1002] Failed to fetch site.css from ' + sourceUrl + ': ' + err.message);
    }
  } else {
    console.warn('[cr-css-1002] CRITICAL_CSS_SOURCE_URL not set — using fallback critical CSS');
  }

  cachedCriticalCss = FALLBACK_CRITICAL_CSS;
  return cachedCriticalCss;
}

/**
 * Load hydration CSS (cr-css-1008) — from cache, remote URL, or fallback.
 *
 * Fetches assets/css/client-hydration.css from S3 via CloudFront, extracts
 * the rules between HYDRATION_CSS_INLINE_BEGIN and HYDRATION_CSS_INLINE_END
 * markers, and returns them for inline injection into the HTML <head> during SSR.
 *
 * This ensures .hydrated-widget and .ssr-hidden styles are present in the
 * server-rendered HTML, eliminating FOUC and preventing style mismatch between
 * SSR and client-hydrated content.
 *
 * @returns {Promise<string>}
 */
async function loadHydrationCss() {
  if (cachedHydrationCss !== null) {
    return cachedHydrationCss;
  }

  const sourceUrl = process.env.HYDRATION_CSS_SOURCE_URL;

  if (sourceUrl) {
    try {
      const cssText = await fetchUrl(sourceUrl);
      const extracted = extractMarkedCss(cssText, 'HYDRATION_CSS_INLINE_BEGIN', 'HYDRATION_CSS_INLINE_END');
      if (extracted) {
        cachedHydrationCss = extracted;
        console.log('[cr-css-1008] Hydration CSS extracted from remote client-hydration.css (' + extracted.length + ' bytes)');
        return cachedHydrationCss;
      }
      console.warn('[cr-css-1008] Markers not found in remote client-hydration.css — using fallback hydration CSS');
    } catch (err) {
      console.error('[cr-css-1008] Failed to fetch client-hydration.css from ' + sourceUrl + ': ' + err.message);
    }
  } else {
    console.warn('[cr-css-1008] HYDRATION_CSS_SOURCE_URL not set — using fallback hydration CSS');
  }

  cachedHydrationCss = FALLBACK_HYDRATION_CSS;
  return cachedHydrationCss;
}

/**
 * Inject critical CSS inline into an HTML string (cr-css-1002).
 *
 * Strategy:
 *   1. Replace the existing static <style> block (between the Lambda@Edge injection
 *      comment markers) with the dynamically loaded critical CSS.
 *   2. If no existing <style> block is found, insert a new one just before </head>.
 *
 * @param {string} html          Original HTML body
 * @param {string} criticalCss   Critical CSS rules to inject
 * @returns {string}             Modified HTML with inlined critical CSS
 */
function injectCriticalCss(html, criticalCss) {
  const STYLE_OPEN  = '<!-- [cr-css-1002 FIX] Critical above-fold CSS inlined — eliminates render-blocking request -->';

  // Build the replacement inline <style> block
  const inlineStyleBlock =
    STYLE_OPEN + '\n' +
    '  <style nonce="{{CSP_NONCE}}">\n' +
    '    /* ============================================================\n' +
    '     * CRITICAL ABOVE-FOLD CSS — injected inline by Lambda@Edge\n' +
    '     * Extracted from assets/css/site.css at CloudFront edge.\n' +
    '     * ============================================================ */\n' +
    criticalCss.split('\n').map(line => '    ' + line).join('\n') + '\n' +
    '  </style>\n';

  // Try to replace the existing static <style> block
  const styleOpenIdx = html.indexOf(STYLE_OPEN);
  if (styleOpenIdx !== -1) {
    const styleTagStart = html.indexOf('<style', styleOpenIdx);
    const styleTagEnd   = html.indexOf('</style>', styleTagStart);
    if (styleTagStart !== -1 && styleTagEnd !== -1) {
      const before = html.slice(0, styleOpenIdx);
      const after  = html.slice(styleTagEnd + '</style>'.length);
      return before + inlineStyleBlock + after;
    }
  }

  // Fallback: insert before </head>
  const headCloseIdx = html.indexOf('</head>');
  if (headCloseIdx !== -1) {
    return (
      html.slice(0, headCloseIdx) +
      '  ' + inlineStyleBlock +
      html.slice(headCloseIdx)
    );
  }

  // Last resort: return HTML unchanged (should never happen for valid HTML)
  console.warn('[cr-css-1002] Could not find injection point in HTML — response unchanged');
  return html;
}

/**
 * Inject hydration CSS inline into an HTML string (cr-css-1008).
 *
 * Inlines the extracted hydration CSS rules (.hydrated-widget, .ssr-hidden,
 * --hydrated-color custom property) into the HTML <head> during SSR so they
 * are present in the server-rendered HTML before client-side JS hydrates.
 *
 * This eliminates Flash of Unstyled Content (FOUC) and prevents style mismatch
 * between server-rendered and client-hydrated content on cloud SSR platforms.
 *
 * Strategy:
 *   1. Replace the existing hydration <style> block (between the Lambda@Edge
 *      hydration injection comment markers) with the dynamically loaded CSS.
 *   2. If no existing hydration <style> block is found, insert a new one
 *      immediately after the critical CSS <style> block (or before </head>).
 *
 * @param {string} html           HTML string (may already have critical CSS injected)
 * @param {string} hydrationCss   Hydration CSS rules to inject
 * @returns {string}              Modified HTML with inlined hydration CSS
 */
function injectHydrationCss(html, hydrationCss) {
  const HYDRATION_STYLE_OPEN  = '<!-- [cr-css-1008 FIX] Hydration CSS inlined — eliminates FOUC on cloud SSR platforms -->';
  const HYDRATION_STYLE_CLOSE = '<!-- [cr-css-1008 FIX] End hydration CSS -->';

  // Build the hydration inline <style> block
  const hydrationStyleBlock =
    HYDRATION_STYLE_OPEN + '\n' +
    '  <style nonce="{{CSP_NONCE}}">\n' +
    '    /* ============================================================\n' +
    '     * HYDRATION CSS — injected inline by Lambda@Edge (cr-css-1008)\n' +
    '     * Extracted from assets/css/client-hydration.css at CloudFront edge.\n' +
    '     * Ensures .hydrated-widget and .ssr-hidden styles are present in\n' +
    '     * server-rendered HTML, eliminating FOUC and style mismatch.\n' +
    '     * ============================================================ */\n' +
    hydrationCss.split('\n').map(line => '    ' + line).join('\n') + '\n' +
    '  </style>\n' +
    '  ' + HYDRATION_STYLE_CLOSE + '\n';

  // Try to replace an existing hydration <style> block (idempotent re-injection)
  const hydrationOpenIdx = html.indexOf(HYDRATION_STYLE_OPEN);
  if (hydrationOpenIdx !== -1) {
    const hydrationCloseIdx = html.indexOf(HYDRATION_STYLE_CLOSE, hydrationOpenIdx);
    if (hydrationCloseIdx !== -1) {
      const before = html.slice(0, hydrationOpenIdx);
      const after  = html.slice(hydrationCloseIdx + HYDRATION_STYLE_CLOSE.length);
      return before + hydrationStyleBlock + after;
    }
  }

  // Insert after the critical CSS <style> block if present
  const CRITICAL_STYLE_MARKER = '<!-- [cr-css-1002 FIX] Critical above-fold CSS inlined';
  const criticalMarkerIdx = html.indexOf(CRITICAL_STYLE_MARKER);
  if (criticalMarkerIdx !== -1) {
    // Find the closing </style> tag after the critical CSS marker
    const criticalStyleEnd = html.indexOf('</style>', criticalMarkerIdx);
    if (criticalStyleEnd !== -1) {
      const insertAt = criticalStyleEnd + '</style>'.length;
      return (
        html.slice(0, insertAt) +
        '\n\n  ' + hydrationStyleBlock +
        html.slice(insertAt)
      );
    }
  }

  // Fallback: insert before </head>
  const headCloseIdx = html.indexOf('</head>');
  if (headCloseIdx !== -1) {
    return (
      html.slice(0, headCloseIdx) +
      '  ' + hydrationStyleBlock +
      html.slice(headCloseIdx)
    );
  }

  // Last resort: return HTML unchanged
  console.warn('[cr-css-1008] Could not find injection point for hydration CSS — response unchanged');
  return html;
}

/**
 * Decode a CloudFront response body (handles base64 encoding).
 *
 * @param {object} response  CloudFront origin response object
 * @returns {string}         Decoded body string
 */
function decodeBody(response) {
  if (response.body) {
    if (response.bodyEncoding === 'base64') {
      return Buffer.from(response.body, 'base64').toString('utf8');
    }
    return response.body;
  }
  return '';
}

/**
 * Encode a body string back for CloudFront (UTF-8, no base64).
 *
 * @param {string} bodyStr
 * @returns {{ body: string, bodyEncoding: string }}
 */
function encodeBody(bodyStr) {
  return { body: bodyStr, bodyEncoding: 'text' };
}

/**
 * Determine whether a CloudFront response is an HTML page.
 *
 * @param {object} response  CloudFront origin response object
 * @returns {boolean}
 */
function isHtmlResponse(response) {
  const headers = response.headers || {};
  const contentTypeHeaders = headers['content-type'] || [];
  return contentTypeHeaders.some(
    (h) => h.value && h.value.toLowerCase().includes('text/html')
  );
}

/**
 * Lambda@Edge handler — origin-response trigger.
 *
 * Intercepts HTML responses from the CloudFront origin and injects:
 *   1. Critical above-fold CSS inline into the <head> (cr-css-1002)
 *   2. Hydration CSS inline into the <head> (cr-css-1008) — eliminates FOUC
 *      and style mismatch between SSR and client-hydrated content.
 *
 * Both CSS blocks are fetched from S3 via CloudFront, extracted using named
 * comment markers, and injected as inline <style> blocks before the response
 * is delivered to the browser.
 *
 * @param {object} event    CloudFront event object
 * @param {object} context  Lambda context object
 * @returns {object}        Modified CloudFront response
 */
exports.handler = async function handler(event, context) { // eslint-disable-line no-unused-vars
  const response = event.Records[0].cf.response;

  // Only process HTML responses — pass everything else through unchanged
  if (!isHtmlResponse(response)) {
    return response;
  }

  // Only process successful responses
  const status = parseInt(response.status, 10);
  if (status < 200 || status >= 300) {
    return response;
  }

  try {
    // Load both CSS blocks in parallel for efficiency
    const [criticalCss, hydrationCss] = await Promise.all([
      loadCriticalCss(),
      loadHydrationCss()
    ]);

    const originalHtml = decodeBody(response);

    if (!originalHtml) {
      console.warn('[cr-css-1002/cr-css-1008] Empty response body — skipping CSS injection');
      return response;
    }

    // Inject critical CSS first (cr-css-1002), then hydration CSS (cr-css-1008)
    let modifiedHtml = injectCriticalCss(originalHtml, criticalCss);
    modifiedHtml     = injectHydrationCss(modifiedHtml, hydrationCss);

    const encoded = encodeBody(modifiedHtml);

    response.body         = encoded.body;
    response.bodyEncoding = encoded.bodyEncoding;

    // Update Content-Length header to reflect the modified body size
    const newLength = Buffer.byteLength(modifiedHtml, 'utf8').toString();
    if (response.headers['content-length']) {
      response.headers['content-length'] = [{ key: 'Content-Length', value: newLength }];
    }

    console.log('[cr-css-1002/cr-css-1008] Critical + hydration CSS injected inline — body size: ' + newLength + ' bytes');
  } catch (err) {
    // On any error, return the original response unchanged to avoid breaking the page
    console.error('[cr-css-1002/cr-css-1008] Error injecting CSS: ' + err.message + '\n' + err.stack);
  }

  return response;
};
