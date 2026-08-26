/**
 * PurgeCSS Configuration for AWS CloudFront Bundle Optimization
 * 
 * This configuration defines how PurgeCSS removes unused CSS rules to:
 *   - Reduce bundle size
 *   - Lower CloudFront bandwidth costs
 *   - Improve page load performance
 *   - Optimize Core Web Vitals
 * 
 * Integration:
 *   - Used by postcss.config.js via @fullhuman/postcss-purgecss
 *   - Executed during AWS CodeBuild build phase
 *   - Applied before uploading to S3 and serving via CloudFront
 * 
 * How it works:
 *   1. Scans content files (HTML, JS, JSX) for CSS class usage
 *   2. Identifies unused CSS selectors
 *   3. Removes unused rules from CSS files
 *   4. Preserves safelisted classes and patterns
 * 
 * Safelist Strategy:
 *   - standard: Exact class names to always keep
 *   - deep: Patterns for nested selectors (e.g., data attributes)
 *   - greedy: Patterns for dynamically generated classes (e.g., CSS-in-JS)
 * 
 * AWS CodeBuild Integration:
 *   Set ENABLE_PURGECSS=true in buildspec.yml to enable optimization
 */

module.exports = {
  // Content files to scan for CSS usage
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
    './assets/**/*.html',
    './public/**/*.html'
  ],
  
  // CSS files to process (can be overridden by PostCSS)
  css: [
    './assets/css/**/*.css'
  ],
  
  // Safelist: CSS classes and patterns that should never be removed
  safelist: {
    // Exact class names to preserve
    standard: [
      'hero',
      'promo',
      'user-card',
      'nav',
      'body'
    ],
    
    // Deep patterns: preserve nested selectors
    deep: [
      /^data-/,        // data-* attributes
      /^aria-/,        // aria-* attributes
      /^user-card/     // user-card and variants
    ],
    
    // Greedy patterns: preserve dynamically generated classes
    greedy: [
      /^emotion-/,     // Emotion CSS-in-JS classes
      /^css-/,         // Generic CSS-in-JS classes
      /^js-/           // JavaScript-controlled classes
    ]
  },
  
  // Default extractor: how to extract class names from content
  defaultExtractor: content => {
    // Broad match: capture most potential class names
    const broadMatches = content.match(/[^<>"'`\s]*[^<>"'`\s:]/g) || [];
    
    // Inner match: capture class names within strings
    const innerMatches = content.match(/[^<>"'`\s.()]*[^<>"'`\s.():]/g) || [];
    
    return broadMatches.concat(innerMatches);
  },
  
  // Variables: preserve CSS custom properties
  variables: true,
  
  // Keyframes: preserve animation keyframes
  keyframes: true,
  
  // Font-face: preserve font declarations
  fontFace: true,
  
  // Rejected: log removed selectors (useful for debugging)
  rejected: process.env.PURGECSS_DEBUG === 'true',
  
  // Rejected CSS output file (for debugging)
  rejectedCss: process.env.PURGECSS_DEBUG === 'true' ? './purgecss-rejected.css' : undefined
};
