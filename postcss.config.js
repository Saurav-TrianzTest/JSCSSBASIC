/**
 * PostCSS Configuration
 *
 * CLOUD REMEDIATION (cr-css-1006): Multiple CSS Files Not Concatenated or HTTP/2
 *
 * postcss-import is added as the FIRST plugin so that all @import statements in
 * assets/css/loader.css are resolved and inlined into a single concatenated CSS
 * bundle (dist/assets/css/bundle.css) at build time. This eliminates the 13
 * separate HTTP requests that were previously required to load each chunk file
 * individually, replacing them with a single request to the S3/CloudFront-hosted
 * bundle.css.
 *
 * cssnano is added to minify the concatenated bundle in production builds
 * (NODE_ENV=production), further reducing CloudFront bandwidth costs and
 * improving page load performance.
 *
 * CLOUD REMEDIATION (cr-css-1010): Environment-Specific Asset Paths in CSS
 *
 * This PostCSS configuration uses postcss-replace to substitute the
 * ${CLOUDFRONT_BASE_URL} placeholder in CSS files with the actual AWS
 * CloudFront distribution URL at build time.
 *
 * CLOUD REMEDIATION (cr-css-1003): Unused CSS Bloating Cloud Bundle Size
 *
 * PurgeCSS (@fullhuman/postcss-purgecss) is integrated here as a PostCSS
 * plugin. When NODE_ENV=production (i.e. during the AWS CodeBuild build step),
 * PurgeCSS scans all HTML and JS content files and removes any CSS selector
 * that is not referenced in those files before the stylesheet is uploaded to
 * S3 and served via CloudFront.
 *
 * This eliminates dead CSS rules (e.g. .deprecated-sidebar) automatically at
 * build time, reducing bundle size, CDN bandwidth costs, and page load time.
 *
 * USAGE:
 *   Set the CLOUDFRONT_BASE_URL environment variable before running the build:
 *     export CLOUDFRONT_BASE_URL=https://<your-distribution>.cloudfront.net
 *
 *   Build the concatenated CSS bundle (cr-css-1006 fix):
 *     npm run build:bundle
 *
 *   Build the concatenated bundle for production (with PurgeCSS + minification):
 *     NODE_ENV=production CLOUDFRONT_BASE_URL=https://d1234abcd.cloudfront.net npm run build:bundle:prod
 *
 *   Build site.css only (legacy):
 *     npm run build:css
 *
 * DEPLOYMENT:
 *   - In CI/CD pipelines (e.g., AWS CodeBuild, GitHub Actions), set
 *     CLOUDFRONT_BASE_URL as a build environment variable or retrieve it
 *     from AWS Systems Manager Parameter Store / Secrets Manager.
 *   - Set NODE_ENV=production in the CodeBuild environment to activate PurgeCSS
 *     and cssnano minification.
 *   - The concatenated, purged, minified CSS is written to dist/assets/css/bundle.css
 *     and should be uploaded to S3 and served via CloudFront.
 *   - Reference only dist/assets/css/bundle.css in production HTML — do NOT
 *     reference individual chunk files or loader.css directly.
 *
 * AWS CODEBUILD BUILDSPEC EXAMPLE:
 *   phases:
 *     install:
 *       commands:
 *         - npm ci
 *     build:
 *       commands:
 *         - export CLOUDFRONT_BASE_URL=$(aws ssm get-parameter --name "/myapp/cloudfront/base-url" --query "Parameter.Value" --output text)
 *         - NODE_ENV=production npm run build:bundle:prod
 *     post_build:
 *       commands:
 *         - aws s3 cp dist/assets/css/bundle.css s3://<your-bucket>/assets/css/bundle.css
 *         - aws cloudfront create-invalidation --distribution-id <DIST_ID> --paths "/assets/css/bundle.css"
 */

const cloudfrontBaseUrl = process.env.CLOUDFRONT_BASE_URL || '';
const isProduction = process.env.NODE_ENV === 'production';

if (!cloudfrontBaseUrl) {
  console.warn(
    '[postcss.config.js] WARNING: CLOUDFRONT_BASE_URL is not set. ' +
    'CSS asset URLs will contain an empty base URL. ' +
    'Set CLOUDFRONT_BASE_URL=https://<your-distribution>.cloudfront.net before building.'
  );
}

if (!isProduction) {
  console.info(
    '[postcss.config.js] INFO: NODE_ENV is not "production" — PurgeCSS and cssnano are DISABLED. ' +
    'Set NODE_ENV=production to enable unused CSS removal and minification for cloud deployments.'
  );
}

/**
 * PurgeCSS configuration for AWS CodeBuild / CloudFront bundle optimisation.
 *
 * CLOUD REMEDIATION (cr-css-1003): Unused CSS Bloating Cloud Bundle Size
 *
 * content: Glob patterns covering every file that may reference a CSS selector.
 *   PurgeCSS scans these files and removes any selector from the output CSS
 *   that is not found in any of the listed content files.
 *
 * safelist: Selectors that must always be kept even if not found in content
 *   files (e.g. dynamically injected class names, third-party widget classes).
 *
 * blocklist: Selectors that must always be removed regardless of content
 *   (e.g. confirmed dead code such as .deprecated-sidebar).
 *
 * rejected: Set to true to log which selectors were removed — useful for
 *   auditing and verifying that only truly unused rules are stripped.
 */
const purgeCSSConfig = {
  content: [
    './**/*.html',
    './src/**/*.js',
    './src/**/*.jsx',
    './src/**/*.ts',
    './src/**/*.tsx',
    './assets/js/**/*.js'
  ],
  // Safelist: always keep these selectors even if not found in content files.
  // Add dynamically-injected class names or third-party widget selectors here.
  safelist: {
    standard: [
      /^nav/,
      /^hero/,
      /^btn/,
      /^user-card/,
      /^promo/
    ],
    deep: [],
    greedy: []
  },
  // Blocklist: always remove these selectors regardless of content files.
  // .deprecated-sidebar was removed in v4 and is confirmed dead code.
  blocklist: [
    '.deprecated-sidebar'
  ],
  // Log removed selectors to CodeBuild output for audit purposes.
  rejected: true,
  rejectedCss: false
};

module.exports = {
  plugins: [
    // [cr-css-1006 FIX] postcss-import — resolve and inline all @import statements
    // from assets/css/loader.css into a single concatenated bundle at build time.
    // This eliminates the 13 separate HTTP requests (10 chunks + deferred + site + brand)
    // and replaces them with a single request to the S3/CloudFront-hosted bundle.css.
    // MUST be the first plugin so imports are resolved before other transformations run.
    require('postcss-import'),

    // [cr-css-1010 FIX] Replace ${CLOUDFRONT_BASE_URL} placeholder with the
    // actual CloudFront distribution URL read from the environment variable.
    require('postcss-replace')({
      pattern: '${CLOUDFRONT_BASE_URL}',
      data: {
        CLOUDFRONT_BASE_URL: cloudfrontBaseUrl
      }
    }),

    // [cr-css-1003 FIX] PurgeCSS — remove unused CSS selectors in production
    // builds to reduce bundle size, CloudFront bandwidth costs, and page load time.
    // Only active when NODE_ENV=production (i.e. during AWS CodeBuild build step).
    ...(isProduction
      ? [
          require('@fullhuman/postcss-purgecss')(purgeCSSConfig)
        ]
      : []),

    // [cr-css-1006 FIX] cssnano — minify the concatenated CSS bundle in production
    // to further reduce file size, CloudFront bandwidth costs, and page load time.
    // Only active when NODE_ENV=production.
    ...(isProduction
      ? [
          require('cssnano')({
            preset: ['default', {
              // Preserve licence/copyright comments in the minified output
              discardComments: { removeAll: false }
            }]
          })
        ]
      : [])
  ]
};
