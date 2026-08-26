/**
 * Client-side hydration for AWS Lambda SSR with Emotion
 * 
 * This file handles client-side hydration after server-side rendering,
 * ensuring styles are properly maintained during the transition.
 */

import { hydrateRoot } from 'react-dom/client';
import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';

/**
 * Initialize Emotion cache for client-side hydration
 * Must match the cache key used on the server ('css')
 */
const cache = createCache({ key: 'css' });

/**
 * Hydrate the React application
 * 
 * @param {ReactElement} App - Your root application component
 */
export function hydrateApp(App) {
  const rootElement = document.getElementById('root');
  
  if (!rootElement) {
    console.error('Root element not found');
    return;
  }

  hydrateRoot(
    rootElement,
    <CacheProvider value={cache}>
      {App}
    </CacheProvider>
  );
}

/**
 * Clean up server-rendered styles after hydration
 * This prevents duplicate styles in the DOM
 */
export function cleanupServerStyles() {
  const serverStyles = document.querySelectorAll('style[data-emotion]');
  
  // Wait for client styles to be injected before removing server styles
  requestAnimationFrame(() => {
    serverStyles.forEach(style => {
      // Only remove if client has taken over
      if (style.getAttribute('data-emotion').includes('css-server')) {
        style.remove();
      }
    });
  });
}

// Auto-cleanup on load
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    // Delay cleanup to ensure client styles are ready
    setTimeout(cleanupServerStyles, 100);
  });
}
