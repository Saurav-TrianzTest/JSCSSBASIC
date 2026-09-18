/**
 * PurgeCSS Configuration — GCP Cloud Build Pipeline Integration
 * ==============================================================
 * CLOUD READINESS FIX (cr-css-1003): Unused CSS Bloating Cloud Bundle Size
 *
 * This configuration is used by the `npm run build:css` script to strip unused
 * CSS selectors before uploading optimised bundles to GCP Cloud Storage / Cloud CDN.
 *
 * How it works in the GCP Cloud Build pipeline:
 *   1. Cloud Build runs `npm run build:css` (which invokes PurgeCSS with this config).
 *   2. PurgeCSS scans all HTML, JS, and JSX content files listed in `content` below.
 *   3. Any CSS selector not referenced in those files is removed from the output.
 *   4. Purged CSS files are written to `dist/css/`.
 *   5. A subsequent Cloud Build step uploads `dist/css/*` to the GCP Cloud Storage
 *      bucket (gs://${_GCP_ASSETS_BUCKET}/css/) which is fronted by Cloud CDN.
 *
 * Cloud Build step snippet (add to cloudbuild.yaml):
 *   steps:
 *     - name: 'node:20'
 *       entrypoint: npm
 *       args: ['ci']
 *     - name: 'node:20'
 *       entrypoint: npm
 *       args: ['run', 'build:css']
 *     - name: 'gcr.io/cloud-builders/gsutil'
 *       args: ['-m', 'cp', '-r', 'dist/css/*',
 *              'gs://${_GCP_ASSETS_BUCKET}/css/']
 *
 * Substitution variables (set in Cloud Build trigger or cloudbuild.yaml):
 *   _GCP_ASSETS_BUCKET: your GCP Cloud Storage bucket name
 *
 * To add new content sources (e.g., server-side templates, additional JS files),
 * extend the `content` array below.
 */

/** @type {import('purgecss').UserDefinedOptions} */
module.exports = {
  /**
   * Content files PurgeCSS scans to determine which CSS selectors are actually used.
   * Extend this list to include any additional template, component, or script files.
   */
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
    './assets/js/**/*.js',
    './middleware/**/*.js'
  ],

  /**
   * CSS files to process. PurgeCSS will remove unused selectors from each.
   */
  css: [
    './assets/css/site.css',
    './assets/css/brand.css',
    './assets/css/loader.css',
    './assets/css/client-hydration.css',
    './assets/css/deferred.css',
    './assets/css/chunks/*.css'
  ],

  /**
   * Output directory for purged CSS files.
   * Cloud Build uploads the contents of this directory to GCP Cloud Storage.
   */
  output: './dist/css/',

  /**
   * Safelist: selectors that must NEVER be removed even if not found in content files.
   * Add dynamically-generated class names or third-party library selectors here.
   *
   * Examples:
   *   - /^animate__/  — animate.css classes applied dynamically via JS
   *   - /^is-/        — state classes toggled at runtime
   */
  safelist: {
    standard: [],
    deep: [/^animate__/],
    greedy: []
  },

  /**
   * Rejected CSS: write a separate file listing all removed selectors for audit.
   * Useful for verifying that no actively-used selectors were accidentally purged.
   */
  rejected: true,
  rejectedCss: true,

  /**
   * Variables: preserve CSS custom properties (--var-name) even if not explicitly
   * referenced in content files, since they may be used dynamically via JS.
   */
  variables: true
};
