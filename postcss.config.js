/**
 * PostCSS Configuration for AWS CloudFront CDN URL Replacement, PurgeCSS, and CSS Minification
 * 
 * This configuration handles:
 * 1. Replacement of CDN_BASE_URL placeholders with CloudFront distribution URL
 * 2. Removal of unused CSS using PurgeCSS to reduce bundle size
 * 
 * Environment Variables:
 *   - CDN_BASE_URL: CloudFront distribution URL (e.g., https://d1234567890.cloudfront.net)
 *   - AWS_REGION: AWS region for SSM Parameter Store (default: us-east-1)
 *   - SSM_PARAMETER_NAME: SSM parameter name for CDN URL (default: /app/cdn/base-url)
 *   - ENABLE_PURGECSS: Enable PurgeCSS optimization (default: true in production)
 * 
 * AWS SSM Parameter Store Setup:
 *   1. Create parameter: aws ssm put-parameter --name /app/cdn/base-url --value "https://d1234567890.cloudfront.net" --type String
 *   2. Retrieve at build: aws ssm get-parameter --name /app/cdn/base-url --query Parameter.Value --output text
 * 
 * PurgeCSS Configuration:
 *   - Scans HTML, JS, JSX files to identify used CSS classes
 *   - Removes unused CSS rules to reduce bundle size
 *   - Reduces CloudFront bandwidth costs and improves page load time
 * 
 * Usage:
 *   - Development: CDN_BASE_URL="" (uses relative paths), ENABLE_PURGECSS=false
 *   - Staging: CDN_BASE_URL="https://staging-cdn.example.com", ENABLE_PURGECSS=true
 *   - Production: CDN_BASE_URL="https://d1234567890.cloudfront.net", ENABLE_PURGECSS=true
 */

const purgecss = require('@fullhuman/postcss-purgecss');

// Enable PurgeCSS in production or when explicitly enabled
const enablePurgeCSS = process.env.ENABLE_PURGECSS === 'true' || process.env.NODE_ENV === 'production';

module.exports = {
  plugins: [
    require('postcss-url')({
      url: (asset) => {
        // Get CDN base URL from environment variable
        const cdnBaseUrl = process.env.CDN_BASE_URL || '';
        
        // Replace CDN_BASE_URL placeholder with actual URL
        if (asset.url.includes('CDN_BASE_URL')) {
          return asset.url.replace('CDN_BASE_URL', cdnBaseUrl);
        }
        
        // For other URLs, prepend CDN base URL if it's an absolute path
        if (cdnBaseUrl && asset.url.startsWith('/')) {
          return cdnBaseUrl + asset.url;
        }
        
        return asset.url;
      }
    }),
    require('autoprefixer'),
    // PurgeCSS: Remove unused CSS to reduce bundle size
    ...(enablePurgeCSS ? [
      purgecss({
        content: [
          './index.html',
          './src/**/*.{js,jsx,ts,tsx}',
          './assets/**/*.html'
        ],
        // Safelist: CSS classes/patterns that should never be removed
        safelist: {
          standard: [
            'hero',
            'promo',
            'user-card'
          ],
          deep: [/^data-/, /^aria-/],
          greedy: [/^emotion-/]
        },
        // Default extractors for different file types
        defaultExtractor: content => {
          // Extract class names, IDs, and other CSS selectors
          const broadMatches = content.match(/[^<>"'`\s]*[^<>"'`\s:]/g) || [];
          const innerMatches = content.match(/[^<>"'`\s.()]*[^<>"'`\s.():]/g) || [];
          return broadMatches.concat(innerMatches);
        }
      })
    ] : []),
    // CSSNano: Minify CSS for production (cr-css-1005)
    // Reduces file size by 40-60% for faster CloudFront delivery
    require('cssnano')({
      preset: ['default', {
        discardComments: {
          removeAll: true,
        },
        normalizeWhitespace: true,
        colormin: true,
        minifySelectors: true,
        minifyParams: true,
        mergeLonghand: true
      }]
    })
  ]
};
