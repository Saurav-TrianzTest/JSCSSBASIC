/**
 * AWS Lambda SSR Handler with Emotion Style Extraction
 * 
 * This module provides server-side rendering with critical CSS extraction
 * for Emotion styled-components to prevent FOUC (Flash of Unstyled Content)
 * during hydration on AWS Lambda.
 */

import { renderToString } from 'react-dom/server';
import { CacheProvider } from '@emotion/react';
import createEmotionServer from '@emotion/server/create-instance';
import createCache from '@emotion/cache';

/**
 * AWS Lambda handler for SSR with Emotion style extraction
 * 
 * @param {Object} event - AWS Lambda event object
 * @param {Object} context - AWS Lambda context object
 * @returns {Object} Lambda response with HTML and extracted styles
 */
export const handler = async (event, context) => {
  try {
    // Create Emotion cache for SSR
    const cache = createCache({ key: 'css' });
    const { extractCriticalToChunks, constructStyleTagsFromChunks } = createEmotionServer(cache);

    // Render your React app with CacheProvider
    // Replace App with your actual root component
    const html = renderToString(
      <CacheProvider value={cache}>
        {/* Your App component here */}
      </CacheProvider>
    );

    // Extract critical styles
    const chunks = extractCriticalToChunks(html);
    const styles = constructStyleTagsFromChunks(chunks);

    // Construct complete HTML with injected styles
    const fullHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Analytics Portal</title>
          ${styles}
        </head>
        <body>
          <div id="root">${html}</div>
          <script src="/assets/js/client.js"></script>
        </body>
      </html>
    `;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300'
      },
      body: fullHtml
    };
  } catch (error) {
    console.error('SSR Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ error: 'Internal Server Error' })
    };
  }
};

/**
 * Alternative: Using extractCritical (simpler API)
 * 
 * @param {ReactElement} app - Your React application root
 * @returns {Object} HTML and CSS strings
 */
export function renderWithEmotionSSR(app) {
  const cache = createCache({ key: 'css' });
  const { extractCritical } = createEmotionServer(cache);

  const html = renderToString(
    <CacheProvider value={cache}>
      {app}
    </CacheProvider>
  );

  const { css, ids } = extractCritical(html);

  return {
    html,
    css,
    ids
  };
}

/**
 * Utility to inject styles into HTML template
 * 
 * @param {string} html - Rendered HTML
 * @param {string} css - Extracted CSS
 * @returns {string} Complete HTML with styles
 */
export function injectStyles(html, css) {
  return html.replace(
    '</head>',
    `<style data-emotion="css">${css}</style></head>`
  );
}
