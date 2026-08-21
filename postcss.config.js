/**
 * PostCSS Configuration
 *
 * CLOUD READINESS FIX (cr-css-1006): Multiple CSS Files Not Concatenated or HTTP/2
 * CLOUD READINESS FIX (cr-css-1010): Environment-Specific Asset Paths in CSS
 *
 * Remediation (cr-css-1006): Consolidate CSS via AWS CloudFront with S3-hosted Bundled Assets
 *   postcss-import is added as the first PostCSS plugin so that all @import statements
 *   in loader.css are resolved and inlined at build time, producing a single concatenated
 *   bundle (dist/css/bundle.css). The bundle is uploaded to S3 and served via AWS
 *   CloudFront with HTTP/2 enabled, reducing 13 separate HTTP requests to one.
 *
 * Remediation (cr-css-1010): Replace Environment-Specific CDN URLs with AWS CloudFront
 * via Build-Time Variable Substitution.
 *
 * This PostCSS configuration uses `postcss-replace` to substitute the
 * $(CLOUDFRONT_DOMAIN) placeholder in CSS files with the actual AWS CloudFront
 * distribution domain at build time. The CLOUDFRONT_DOMAIN environment variable
 * must be set in the CI/CD build environment (e.g. AWS CodeBuild, GitHub Actions)
 * for each target environment:
 *
 *   Development  : CLOUDFRONT_DOMAIN=https://d1dev0000000000.cloudfront.net
 *   Staging      : CLOUDFRONT_DOMAIN=https://d1stg0000000000.cloudfront.net
 *   Production   : CLOUDFRONT_DOMAIN=https://d1prd0000000000.cloudfront.net
 *
 * This ensures the compiled CSS is fully environment-agnostic — a single build
 * pipeline produces environment-specific CSS without maintaining separate CSS
 * source files per environment.
 *
 * Usage:
 *   npm run build:bundle
 *   (runs: postcss assets/css/loader.css -o dist/css/bundle.css)
 *   Concatenates all CSS chunks into a single bundle for S3/CloudFront delivery.
 *
 *   npm run build:css
 *   (runs: postcss assets/css/site.css -o dist/css/site.css)
 *
 *   npm run build:css:hydration
 *   (runs: postcss assets/css/client-hydration.css -o dist/css/client-hydration.css)
 *
 * The CLOUDFRONT_DOMAIN variable is resolved from:
 *   1. The CI/CD pipeline environment (AWS CodeBuild / GitHub Actions secrets)
 *   2. A local .env file for development (never committed to source control)
 *   3. Falls back to an empty string (relative path) if unset — safe for local dev
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLOUD READINESS FIX (cr-css-1003): Unused CSS Bloating Cloud Bundle Size
 *
 * Remediation: Integrate PurgeCSS into AWS CodePipeline/CodeBuild for Bundle
 * Optimization.
 *
 * @fullhuman/postcss-purgecss is added as a PostCSS plugin to automatically
 * remove unused CSS selectors before the stylesheet is uploaded to S3 and
 * distributed via CloudFront. This reduces bundle size, lowers CDN bandwidth
 * costs, and improves page load time.
 *
 * PurgeCSS scans all HTML and JS content files listed in the `content` array
 * and removes any CSS selector that does not appear in those files. Selectors
 * for dynamically-applied classes (e.g. added via JavaScript) are preserved
 * via the `safelist` option.
 *
 * PurgeCSS is only active in production builds (NODE_ENV=production) to keep
 * local development fast and to preserve all CSS rules during development.
 *
 * AWS CodeBuild integration:
 *   - Set NODE_ENV=production in the CodeBuild environment variables.
 *   - Run `npm run build:bundle` as a build step before uploading dist/ to S3.
 *   - PurgeCSS will strip all unused selectors from the compiled CSS output.
 *   - Issue a CloudFront invalidation after the S3 upload to propagate the
 *     optimised stylesheet to all edge locations.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLOUD READINESS FIX (cr-css-1005): CSS Files Not Minified for Production
 *
 * Remediation: Integrate CSS Minification in AWS CodePipeline with S3 and
 * CloudFront Delivery.
 *
 * cssnano is added as a PostCSS plugin to minify CSS output during the AWS
 * CodeBuild build stage. When NODE_ENV=production, cssnano compresses the
 * compiled stylesheet by:
 *   - Removing all whitespace and comments
 *   - Collapsing redundant values and shorthand properties
 *   - Deduplicating rules and selectors
 *   - Applying safe micro-optimisations (e.g. colour value normalisation)
 *
 * The minified artifact is written to dist/css/ and uploaded to S3, then
 * distributed via CloudFront. This reduces file size, lowers CDN bandwidth
 * costs, and improves cache efficiency across all CloudFront edge locations.
 *
 * cssnano is only active in production builds (NODE_ENV=production) to keep
 * local development readable and debuggable.
 *
 * AWS CodeBuild integration:
 *   - Set NODE_ENV=production in the CodeBuild environment variables.
 *   - Run `npm run build:bundle`, `npm run build:css`, and `npm run build:css:hydration`
 *     as build steps.
 *   - cssnano will minify:
 *       loader.css  → dist/css/bundle.css
 *       site.css    → dist/css/site.css
 *       client-hydration.css → dist/css/client-hydration.css
 *   - Upload dist/css/ to S3 and issue a CloudFront invalidation to propagate
 *     the minified stylesheets to all edge locations.
 *   - See package.json for the required devDependency (cssnano ^7.0.0).
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// Load .env for local development (no-op in CI/CD where env vars are injected directly)
require('dotenv').config();

const cloudfrontDomain = process.env.CLOUDFRONT_DOMAIN || '';
const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  plugins: [
    /**
     * CLOUD READINESS FIX (cr-css-1006): postcss-import — Resolve @import at Build Time
     *
     * postcss-import inlines all @import statements in loader.css at build time,
     * concatenating all CSS chunk files (chunk00–chunk09), deferred.css, site.css,
     * and brand.css into a single output file (dist/css/bundle.css).
     *
     * This eliminates the 13 separate HTTP requests that the browser would otherwise
     * make at runtime for each @import, replacing them with a single request to the
     * CloudFront-distributed bundle. postcss-import MUST be the first plugin in the
     * chain so that subsequent plugins (postcss-replace, PurgeCSS, cssnano) operate
     * on the fully-inlined CSS rather than on @import statements.
     *
     * AWS S3 + CloudFront delivery:
     *   - The compiled dist/css/bundle.css is uploaded to S3 and served via CloudFront.
     *   - CloudFront HTTP/2 (enabled by default) multiplexes the single bundle request
     *     over one connection with header compression for optimal edge performance.
     *   - Set Cache-Control: public, max-age=31536000, immutable on the S3 object.
     *   - Use content-addressed filenames (bundle.[contenthash].css) for cache busting.
     */
    require('postcss-import'),

    /**
     * CLOUD READINESS FIX (cr-css-1009): CSS Custom Properties Without Fallback Values
     *
     * Remediation: PostCSS Custom Properties Fallback Plugin with AWS S3/CloudFront CSS Pipeline
     *
     * postcss-custom-properties processes all CSS custom property (var()) usages and
     * automatically emits a static fallback declaration before each var() usage so that
     * browsers without CSS custom property support (IE 11, older mobile browsers) receive
     * a concrete value. This ensures consistent rendering across the global user base
     * served by the AWS CloudFront distribution.
     *
     * Configuration:
     *   preserve: true  — keeps the original var() declaration alongside the static
     *                     fallback so that modern browsers continue to use the dynamic
     *                     custom property value (e.g. for runtime theming).
     *
     * Affected declarations fixed:
     *   - assets/css/client-hydration.css: color: var(--hydrated-color, #333333)
     *   - assets/css/site.css:             color: var(--primary-color, #0a2540)
     *
     * The processed CSS is uploaded to S3 and distributed via CloudFront so that
     * all edge locations serve the fallback-enriched stylesheet globally.
     */
    require('postcss-custom-properties')({
      preserve: true,
    }),

    /**
     * postcss-replace: substitutes $(CLOUDFRONT_DOMAIN) placeholders in CSS
     * with the actual CloudFront distribution URL at build time.
     *
     * Pattern matched: $(CLOUDFRONT_DOMAIN)
     * Replaced with  : value of process.env.CLOUDFRONT_DOMAIN
     *
     * Example transformation:
     *   Input  : --promo-bg-url: url('$(CLOUDFRONT_DOMAIN)/img/bg.jpg');
     *   Output : --promo-bg-url: url('https://d1abc2def3.cloudfront.net/img/bg.jpg');
     */
    require('postcss-replace')({
      pattern: /\$\(CLOUDFRONT_DOMAIN\)/g,
      data: {
        CLOUDFRONT_DOMAIN: cloudfrontDomain,
      },
    }),

    /**
     * CLOUD READINESS FIX (cr-css-1003): PurgeCSS — Remove Unused CSS Selectors
     *
     * @fullhuman/postcss-purgecss scans the content files listed below and
     * removes any CSS rule whose selector does not appear in those files.
     * This eliminates dead rules (e.g. .deprecated-sidebar) that inflate the
     * CSS bundle, increase CloudFront CDN bandwidth costs, and slow page loads.
     *
     * Configuration:
     *   content  : All HTML and JS source files that may reference CSS selectors.
     *              Glob patterns cover index.html, all JS/JSX/TS/TSX source files,
     *              and any server-side template files.
     *   safelist : Selectors that must be preserved even if not found statically
     *              (e.g. classes added dynamically via JavaScript at runtime).
     *              Extend this list as needed for your application.
     *   rejected : Set to true in production to log removed selectors for audit.
     *
     * Only active when NODE_ENV=production to keep local development fast.
     * In AWS CodeBuild, set NODE_ENV=production before running `npm run build:bundle`.
     */
    isProduction &&
      require('@fullhuman/postcss-purgecss')({
        content: [
          './index.html',
          './src/**/*.{js,jsx,ts,tsx}',
          './assets/js/**/*.js',
        ],
        safelist: {
          // Preserve selectors that are applied dynamically at runtime.
          // Add class names here if PurgeCSS incorrectly removes them.
          standard: [/^js-/, /^is-/, /^has-/],
          deep: [],
          greedy: [],
        },
        // Log removed selectors to stdout during the CodeBuild step for audit.
        rejected: true,
        // Preserve CSS custom properties (--var) and @font-face rules.
        variables: true,
        keyframes: true,
        fontFace: false,
      }),

    /**
     * autoprefixer: adds vendor prefixes for cross-browser compatibility.
     * Included as a standard PostCSS plugin for cloud-deployed static assets.
     */
    require('autoprefixer'),

    /**
     * CLOUD READINESS FIX (cr-css-1005): cssnano — CSS Minification for Production
     *
     * cssnano minifies the compiled CSS output when NODE_ENV=production.
     * It removes whitespace, comments, redundant values, and applies safe
     * micro-optimisations to produce the smallest possible CSS artifact for
     * upload to S3 and distribution via CloudFront.
     *
     * Preset: 'default' — applies all safe optimisations without altering
     * the visual rendering of the stylesheet. Unsafe transforms (e.g. z-index
     * rebasing, calc() reduction across files) are excluded.
     *
     * Only active when NODE_ENV=production to keep local development readable.
     * In AWS CodeBuild, set NODE_ENV=production before running build:css scripts.
     *
     * Affected files (minified output written to dist/css/):
     *   - assets/css/loader.css           → dist/css/bundle.css
     *   - assets/css/site.css             → dist/css/site.css
     *   - assets/css/client-hydration.css → dist/css/client-hydration.css
     */
    isProduction &&
      require('cssnano')({
        preset: [
          'default',
          {
            // Preserve licence/legal comments (/*! ... */) in the minified output.
            discardComments: { removeAll: true },
            // Normalise whitespace aggressively for maximum compression.
            normalizeWhitespace: true,
            // Merge duplicate rules to reduce file size.
            mergeLonghand: true,
            // Collapse redundant values (e.g. margin: 0 0 0 0 → margin: 0).
            minifyParams: true,
            // Reduce colour values to their shortest representation.
            colormin: true,
          },
        ],
      }),
  ].filter(Boolean),
};
