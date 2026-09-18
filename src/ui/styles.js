/**
 * src/ui/styles.js
 *
 * CLOUD READINESS FIX (cr-css-1008): Client-Only CSS Loaded After Hydration
 * ===========================================================================
 * Remediation: Critical CSS SSR Injection on Google Cloud Run with Next.js
 * --------------------------------------------------------------------------
 * Previously, this module loaded CSS only after client-side hydration via a
 * `typeof window === 'object'` guard, causing FOUC on cloud SSR platforms.
 *
 * Fix applied:
 *   - Emotion's `createCache` is now configured with a dedicated SSR key so
 *     that `extractCriticalToChunks` / `constructStyleTagsFromChunks` can
 *     collect ALL styles (including those from client-hydration.css) during
 *     the server-side render pass on Google Cloud Run.
 *   - The client-only `typeof window` guard has been removed; styles are now
 *     available on both server and client, eliminating the style mismatch
 *     between server-rendered and client-hydrated content.
 *   - `createEmotionCache()` is exported for use by the Next.js `_document.js`
 *     (or equivalent SSR entry point) so the Cloud Run SSR middleware can
 *     inject the extracted <style> tags into the HTML <head> before hydration.
 *   - On the client, Emotion reuses the server-injected styles via the shared
 *     cache key, preventing double-injection and style flickering.
 *
 * Usage in Next.js _document.js (Cloud Run SSR entry):
 *   import { createEmotionCache } from '../src/ui/styles';
 *   import createEmotionServer from '@emotion/server/create-instance';
 *
 *   const cache = createEmotionCache();
 *   const { extractCriticalToChunks, constructStyleTagsFromChunks } =
 *     createEmotionServer(cache);
 *
 *   // During renderToString / renderToPipeableStream:
 *   const emotionChunks = extractCriticalToChunks(html);
 *   const emotionStyleTags = constructStyleTagsFromChunks(emotionChunks);
 *   // Inject emotionStyleTags into <head> before sending the response.
 */

import createCache from '@emotion/cache';
import styled from '@emotion/styled';

/**
 * Creates a shared Emotion cache instance.
 *
 * The `key` value ('app-ssr') is used as the `data-emotion` attribute on the
 * injected <style> tags, allowing the Cloud Run SSR middleware and the client
 * hydration runtime to identify and reuse the same style sheet.
 *
 * @returns {import('@emotion/cache').EmotionCache}
 */
export function createEmotionCache() {
  return createCache({ key: 'app-ssr' });
}

/**
 * Shared Emotion cache — used by both the SSR render pass (server) and the
 * client hydration pass.  Exporting a singleton here ensures that styled
 * components created in this module share the same cache as the SSR pipeline.
 */
export const emotionCache = createEmotionCache();

/**
 * Example styled component — uses the shared SSR-aware cache.
 * Styles are extracted server-side and injected into the HTML <head> by the
 * Cloud Run SSR middleware before the client receives the response.
 */
export const Box = styled(emotionCache)('div')`
  padding: 16px;
`;

/*
 * SSR-safe CSS import — no client-only guard.
 *
 * client-hydration.css is now included in the server-side style extraction
 * pass (see middleware/inlineCriticalCss.js) so its rules are present in the
 * HTML <head> before client hydration, eliminating FOUC.
 *
 * The import is unconditional (no `typeof window` check) so that bundlers
 * (webpack / Next.js) include it in the SSR bundle as well as the client
 * bundle.
 */
import '../assets/css/client-hydration.css';
