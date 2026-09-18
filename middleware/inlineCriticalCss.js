/**
 * middleware/inlineCriticalCss.js
 *
 * Cloud Run Edge Middleware — Inline Critical CSS + Emotion SSR Style Injection
 * ==============================================================================
 * CLOUD READINESS FIX (cr-css-1002): Critical CSS Not Inlined for Above-Fold Content
 * CLOUD READINESS FIX (cr-css-1008): Client-Only CSS Loaded After Hydration
 *
 * Remediation (cr-css-1002): Inline Critical CSS via Cloud CDN and Cloud Run Edge Middleware
 * Remediation (cr-css-1008): Critical CSS SSR Injection on Google Cloud Run with Next.js
 * ------------------------------------------------------------------------------------------
 * This middleware runs on Cloud Run and intercepts HTML responses before they are
 * served through Cloud CDN. It performs two injections:
 *
 *   1. CRITICAL ABOVE-FOLD CSS (cr-css-1002):
 *      Inlines the critical above-fold CSS directly into the HTML <head>,
 *      eliminating render-blocking external CSS requests and improving
 *      First Contentful Paint (FCP) — a Core Web Vital measured by GCP.
 *
 *   2. EMOTION SSR STYLE INJECTION (cr-css-1008):
 *      Injects Emotion-extracted <style data-emotion="app-ssr"> tags into the
 *      HTML <head> BEFORE client hydration, ensuring that styles from
 *      client-hydration.css (and all other Emotion-managed styles) are present
 *      in the server-rendered HTML.  This eliminates the Flash of Unstyled
 *      Content (FOUC) caused by styles that were previously only available
 *      after client-side JavaScript hydration.
 *
 * How it works:
 *   1. Intercepts outgoing HTML responses (Content-Type: text/html).
 *   2. Reads the critical CSS from the GCP Cloud Storage bucket (cached in-process).
 *   3. Injects a <style data-critical="true"> block into the HTML <head>
 *      immediately after the opening <head> tag (cr-css-1002).
 *   4. Injects Emotion SSR <style data-emotion="app-ssr"> tags collected during
 *      the render pass into the HTML <head> after the critical CSS block (cr-css-1008).
 *   5. Passes the modified response to Cloud CDN for edge caching and delivery.
 *
 * Environment variables (set in Cloud Run service configuration):
 *   GCP_ASSETS_BUCKET  — GCP Cloud Storage bucket name for static assets
 *   CRITICAL_CSS_PATH  — Path within the bucket to the critical CSS file
 *                        (default: css/critical-above-fold.css)
 *   NODE_ENV           — Set to 'production' in Cloud Run
 *
 * Usage (Express / Node.js HTTP server on Cloud Run):
 *   const { inlineCriticalCssMiddleware } = require('./middleware/inlineCriticalCss');
 *   app.use(inlineCriticalCssMiddleware);
 *
 * Usage with Emotion SSR (Next.js / Cloud Run SSR):
 *   // In your SSR render function, attach emotion style tags to res.locals:
 *   const cache = createEmotionCache();
 *   const { extractCriticalToChunks, constructStyleTagsFromChunks } =
 *     createEmotionServer(cache);
 *   const emotionChunks = extractCriticalToChunks(html);
 *   res.locals.emotionStyleTags = constructStyleTagsFromChunks(emotionChunks);
 *   // The middleware will inject res.locals.emotionStyleTags into the <head>.
 *
 * @module middleware/inlineCriticalCss
 */

'use strict';

// ---------------------------------------------------------------------------
// Critical CSS — inlined directly for zero-latency injection.
// In production, this content is also fetched from GCP Cloud Storage and
// cached in-process. The static fallback below ensures the middleware works
// even if the Cloud Storage fetch is unavailable (e.g., cold start, network).
// ---------------------------------------------------------------------------
const STATIC_CRITICAL_CSS = `
  /* === Critical above-the-fold CSS — injected by Cloud Run Edge Middleware === */

  /* Base reset / layout */
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.5; color: #0a2540; }
  img, svg { display: block; max-width: 100%; }

  /* Navigation — above fold */
  .nav { height: 56px; display: flex; align-items: center; padding: 0 24px; background: #fff; border-bottom: 1px solid #e5e7eb; }
  .nav__logo { font-weight: 700; font-size: 1.125rem; color: #0a2540; text-decoration: none; }
  .nav__links { display: flex; gap: 24px; list-style: none; margin: 0; padding: 0; }
  .nav__links a { color: #374151; text-decoration: none; font-size: 0.9375rem; }
  .nav__links a:hover { color: #0a2540; }

  /* Hero section — above fold */
  .hero { min-height: 480px; display: flex; flex-direction: column; justify-content: center; padding: 64px 24px; background: #f8fafc; }
  .hero__title { font-size: clamp(1.75rem, 4vw, 3rem); font-weight: 800; color: #0a2540; margin: 0 0 16px; }
  .hero__subtitle { font-size: 1.125rem; color: #4b5563; margin: 0 0 32px; max-width: 560px; }
  .hero__cta { display: inline-flex; align-items: center; gap: 8px; padding: 12px 28px; background: #0a2540; color: #fff; border-radius: 6px; font-weight: 600; text-decoration: none; font-size: 1rem; }
  .hero__cta:hover { background: #0d3060; }

  /* Loader / skeleton — above fold */
  .skeleton { background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; border-radius: 4px; }
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

  /* Utility — above fold */
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  .container { width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 24px; }

  /* === Hydration styles — SSR-injected to prevent FOUC (cr-css-1008 fix) === */
  /* Previously loaded only after client-side JS hydration; now injected      */
  /* server-side so styles are present before client hydration begins.         */
  .hydrated-widget { opacity: 1; transition: opacity 0.3s; background: url('https://cdn.example.net/client-only-bg.png'); }
  .ssr-hidden { display: block; color: var(--hydrated-color); }
`.trim();

// ---------------------------------------------------------------------------
// In-process cache for critical CSS fetched from GCP Cloud Storage.
// Avoids repeated network calls on Cloud Run instances.
// ---------------------------------------------------------------------------
let _cachedCriticalCss = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches critical CSS from GCP Cloud Storage and caches it in-process.
 * Falls back to the static inline copy if the fetch fails.
 *
 * @returns {Promise<string>} The critical CSS string.
 */
async function getCriticalCss() {
  const now = Date.now();
  if (_cachedCriticalCss && now - _cacheTimestamp < CACHE_TTL_MS) {
    return _cachedCriticalCss;
  }

  const bucket = process.env.GCP_ASSETS_BUCKET;
  const cssPath = process.env.CRITICAL_CSS_PATH || 'css/critical-above-fold.css';

  if (!bucket) {
    // No bucket configured — use static fallback (development / local mode)
    return STATIC_CRITICAL_CSS;
  }

  try {
    // Dynamically require @google-cloud/storage only when available.
    // This keeps the middleware usable in environments without the GCS SDK.
    const { Storage } = require('@google-cloud/storage'); // eslint-disable-line
    const storage = new Storage();
    const [contents] = await storage.bucket(bucket).file(cssPath).download();
    _cachedCriticalCss = contents.toString('utf8');
    _cacheTimestamp = now;
    return _cachedCriticalCss;
  } catch (err) {
    // Log the error for GCP Cloud Logging (structured JSON)
    console.error(JSON.stringify({
      severity: 'WARNING',
      message: 'inlineCriticalCssMiddleware: failed to fetch critical CSS from GCS, using static fallback',
      bucket,
      cssPath,
      error: err && err.message,
    }));
    return STATIC_CRITICAL_CSS;
  }
}

/**
 * Builds the <style> tag string to inject into the HTML <head>.
 *
 * @param {string} css - The critical CSS content.
 * @returns {string} The <style> block HTML string.
 */
function buildStyleTag(css) {
  return `<style data-critical="true">\n${css}\n</style>`;
}

/**
 * Builds the Emotion SSR <style> tag(s) to inject into the HTML <head>.
 *
 * Emotion's `constructStyleTagsFromChunks` returns a string of one or more
 * <style data-emotion="app-ssr ..."> tags.  These are injected after the
 * critical CSS block so that component-level styles override base styles
 * correctly, matching the client-side cascade order.
 *
 * @param {string} emotionStyleTags - HTML string of Emotion <style> tags.
 * @returns {string} The Emotion style tags string (passed through as-is).
 */
function buildEmotionStyleTags(emotionStyleTags) {
  if (!emotionStyleTags || typeof emotionStyleTags !== 'string') return '';
  return `\n  <!-- Emotion SSR styles (cr-css-1008) -->\n  ${emotionStyleTags.trim()}`;
}

/**
 * Express middleware that:
 *   1. Inlines critical above-fold CSS into HTML responses (cr-css-1002).
 *   2. Injects Emotion SSR <style> tags into HTML responses before client
 *      hydration to eliminate FOUC (cr-css-1008).
 *
 * Intercepts responses with Content-Type: text/html and injects style blocks
 * immediately after the opening <head> tag.
 *
 * For Emotion SSR injection, the render function must attach the Emotion style
 * tags string to `res.locals.emotionStyleTags` before calling `res.end()`.
 * Example (Next.js / Express SSR):
 *
 *   import createEmotionServer from '@emotion/server/create-instance';
 *   import { createEmotionCache } from '../src/ui/styles';
 *
 *   const cache = createEmotionCache();
 *   const { extractCriticalToChunks, constructStyleTagsFromChunks } =
 *     createEmotionServer(cache);
 *
 *   app.get('*', (req, res, next) => {
 *     const html = renderToString(<App emotionCache={cache} />);
 *     const chunks = extractCriticalToChunks(html);
 *     res.locals.emotionStyleTags = constructStyleTagsFromChunks(chunks);
 *     res.send(html);
 *   });
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {Function} next
 */
async function inlineCriticalCssMiddleware(req, res, next) {
  // Only intercept HTML responses
  const _writeHead = res.writeHead.bind(res);
  const _write = res.write.bind(res);
  const _end = res.end.bind(res);

  let isHtml = false;
  let buffer = '';

  res.writeHead = function (statusCode, statusMessage, headers) {
    const resolvedHeaders = (typeof statusMessage === 'object' ? statusMessage : headers) || {};
    const contentType = resolvedHeaders['content-type'] || resolvedHeaders['Content-Type'] || res.getHeader('content-type') || '';
    isHtml = String(contentType).includes('text/html');

    if (isHtml) {
      // Remove Content-Length — it will change after injection
      res.removeHeader('content-length');
      res.removeHeader('Content-Length');
      if (resolvedHeaders['content-length']) delete resolvedHeaders['content-length'];
      if (resolvedHeaders['Content-Length']) delete resolvedHeaders['Content-Length'];
    }

    if (typeof statusMessage === 'object') {
      return _writeHead(statusCode, resolvedHeaders);
    }
    return _writeHead(statusCode, statusMessage, resolvedHeaders);
  };

  res.write = function (chunk) {
    if (!isHtml) return _write(chunk);
    buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
    return true;
  };

  res.end = async function (chunk, encoding) {
    if (!isHtml) return _end(chunk, encoding);

    if (chunk) {
      buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : (chunk || '');
    }

    try {
      // --- cr-css-1002: Critical above-fold CSS injection ---
      const criticalCss = await getCriticalCss();
      const styleTag = buildStyleTag(criticalCss);

      // --- cr-css-1008: Emotion SSR style injection ---
      // Emotion style tags are attached to res.locals by the SSR render function.
      // If not present (e.g., non-SSR routes), this is a no-op.
      const emotionStyleTagsHtml = buildEmotionStyleTags(
        (res.locals && res.locals.emotionStyleTags) || ''
      );

      // Inject after <head> (or <head ...>) — avoid duplicating if already present
      let modified = buffer;
      if (!modified.includes('data-critical="true"')) {
        // Inject critical CSS block first, then Emotion SSR styles immediately after
        const injection = `$1\n  ${styleTag}${emotionStyleTagsHtml}`;
        modified = modified.replace(/(<head[^>]*>)/i, injection);
      } else if (emotionStyleTagsHtml && !modified.includes('data-emotion="app-ssr"')) {
        // Critical CSS already present — only inject Emotion SSR styles if missing
        modified = modified.replace(
          /(<style data-critical="true">[\s\S]*?<\/style>)/i,
          `$1${emotionStyleTagsHtml}`
        );
      }

      _end(modified, 'utf8');
    } catch (err) {
      console.error(JSON.stringify({
        severity: 'ERROR',
        message: 'inlineCriticalCssMiddleware: failed to inject critical/emotion CSS',
        error: err && err.message,
      }));
      // Fall back to unmodified response
      _end(buffer, 'utf8');
    }
  };

  next();
}

module.exports = { inlineCriticalCssMiddleware, getCriticalCss, buildStyleTag, buildEmotionStyleTags };
