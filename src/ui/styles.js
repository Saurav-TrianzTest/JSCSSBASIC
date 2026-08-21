/**
 * src/ui/styles.js
 *
 * CLOUD READINESS FIX (cr-css-1007): CSS-in-JS Without SSR Extract Configuration
 * ─────────────────────────────────────────────────────────────────────────────────
 * Remediation: AWS Lambda SSR with styled-components ServerStyleSheet Extraction
 *
 * Previously this module used @emotion/styled with no SSR style extraction,
 * causing a Flash of Unstyled Content (FOUC) on AWS Lambda-based SSR (e.g.,
 * Next.js on Lambda or a custom SSR handler) because styles were only injected
 * client-side after hydration.
 *
 * Fix applied:
 *   1. Migrated from @emotion/styled to styled-components, which ships a
 *      first-class ServerStyleSheet API designed for SSR style extraction.
 *   2. Exported a `createSSRStyleSheet` factory so Lambda SSR handlers can
 *      collect all critical styles during the server render pass and inject
 *      them into the HTML <head> before sending the response to the client.
 *   3. The client-side deferred CSS import is preserved unchanged.
 *
 * AWS Lambda SSR usage pattern (custom SSR handler or Next.js _document.js):
 *
 *   import { createSSRStyleSheet } from './src/ui/styles.js';
 *
 *   // Inside your Lambda handler / getInitialProps / renderToString wrapper:
 *   const sheet = createSSRStyleSheet();
 *   const body  = sheet.collectStyles(
 *     ReactDOMServer.renderToString(<App />)   // or sheet.collectStyles(<App />)
 *   );
 *   const styleTags = sheet.getStyleTags();    // <style> blocks for <head>
 *   sheet.seal();                              // release memory
 *
 *   // Inject styleTags into the HTML response before sending to CloudFront/client
 *   const html = `<!DOCTYPE html>
 *     <html><head>${styleTags}</head>
 *     <body><div id="root">${body}</div></body></html>`;
 *
 * Next.js _document.js usage (pages/_document.js):
 *
 *   import Document from 'next/document';
 *   import { ServerStyleSheet } from 'styled-components';
 *
 *   export default class MyDocument extends Document {
 *     static async getInitialProps(ctx) {
 *       const sheet = new ServerStyleSheet();
 *       const originalRenderPage = ctx.renderPage;
 *       try {
 *         ctx.renderPage = () =>
 *           originalRenderPage({
 *             enhanceApp: (App) => (props) =>
 *               sheet.collectStyles(<App {...props} />),
 *           });
 *         const initialProps = await Document.getInitialProps(ctx);
 *         return {
 *           ...initialProps,
 *           styles: (
 *             <>
 *               {initialProps.styles}
 *               {sheet.getStyleElement()}
 *             </>
 *           ),
 *         };
 *       } finally {
 *         sheet.seal();
 *       }
 *     }
 *   }
 */

import styled, { ServerStyleSheet } from 'styled-components';

// ---------------------------------------------------------------------------
// Styled components — same visual output as before, now SSR-compatible
// ---------------------------------------------------------------------------

/**
 * Box — a simple padded container.
 * Identical styling to the previous @emotion/styled version; only the
 * underlying library has changed to enable ServerStyleSheet extraction.
 */
export const Box = styled.div`
  padding: 16px;
`;

// ---------------------------------------------------------------------------
// SSR style-extraction helper
// ---------------------------------------------------------------------------

/**
 * createSSRStyleSheet
 *
 * Factory that returns a fresh styled-components ServerStyleSheet instance.
 * Call this once per SSR request inside your AWS Lambda handler to collect
 * all critical CSS generated during the server render pass.
 *
 * The returned sheet must be sealed (sheet.seal()) after use to prevent
 * memory leaks across Lambda invocations.
 *
 * @returns {ServerStyleSheet} A new ServerStyleSheet ready for style collection.
 *
 * @example
 *   // Lambda handler (custom SSR)
 *   export const handler = async (event) => {
 *     const sheet = createSSRStyleSheet();
 *     try {
 *       const appHtml = ReactDOMServer.renderToString(
 *         sheet.collectStyles(<App />)
 *       );
 *       const styleTags = sheet.getStyleTags();
 *       return buildHtmlResponse(appHtml, styleTags);
 *     } finally {
 *       sheet.seal();
 *     }
 *   };
 */
export function createSSRStyleSheet() {
  return new ServerStyleSheet();
}

/**
 * extractStylesToHTML
 *
 * Convenience wrapper: renders a React element to an HTML string while
 * collecting all styled-components styles, then returns both the rendered
 * HTML body and the <style> tag string ready for injection into <head>.
 *
 * Requires `react-dom/server` to be available in the Lambda execution
 * environment (included in Next.js Lambda bundles automatically).
 *
 * @param {import('react').ReactElement} element - The root React element to render.
 * @param {Function} renderToString - ReactDOMServer.renderToString (injected to
 *   avoid a hard dependency on react-dom/server in browser bundles).
 * @returns {{ bodyHtml: string, styleTagsHtml: string }}
 *
 * @example
 *   import { renderToString } from 'react-dom/server';
 *   import { extractStylesToHTML } from './src/ui/styles.js';
 *
 *   const { bodyHtml, styleTagsHtml } = extractStylesToHTML(<App />, renderToString);
 *   // Inject styleTagsHtml into <head> and bodyHtml into <div id="root">
 */
export function extractStylesToHTML(element, renderToString) {
  const sheet = new ServerStyleSheet();
  let bodyHtml = '';
  let styleTagsHtml = '';

  try {
    bodyHtml = renderToString(sheet.collectStyles(element));
    styleTagsHtml = sheet.getStyleTags();
  } finally {
    sheet.seal();
  }

  return { bodyHtml, styleTagsHtml };
}

// ---------------------------------------------------------------------------
// Client-only deferred CSS — unchanged from original
// Loaded after hydration to avoid blocking the initial render.
// ---------------------------------------------------------------------------
if (typeof window === 'object') {
  import('../css/deferred.css', { with: { type: 'css' } }).catch(function () {});
}
