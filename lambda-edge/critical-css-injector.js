/**
 * Lambda@Edge — Critical CSS Injector (viewer-response)
 *
 * CLOUD READINESS FIX (cr-css-1002): Critical CSS Not Inlined for Above-Fold Content
 * CLOUD READINESS FIX (cr-css-1008): Client-Only CSS Loaded After Hydration
 *
 * Purpose:
 *   This Lambda@Edge function runs as a CloudFront viewer-response handler.
 *   It intercepts every HTML response delivered by CloudFront and injects:
 *     1. The pre-built critical CSS bundle inline into the <head>, replacing the
 *        <!-- LAMBDA_EDGE_CRITICAL_CSS_PLACEHOLDER --> comment in index.html.
 *     2. The pre-built hydration CSS bundle inline into the <head>, replacing the
 *        <!-- LAMBDA_EDGE_HYDRATION_CSS_PLACEHOLDER --> comment in index.html.
 *
 *   By inlining both CSS bundles at the CloudFront edge (closest to the end user),
 *   the browser can paint above-fold content and hydrated components without issuing
 *   any additional network requests for stylesheets, directly improving First
 *   Contentful Paint (FCP) and Largest Contentful Paint (LCP) Core Web Vitals scores,
 *   and eliminating Flash of Unstyled Content (FOUC) on SSR pages.
 *
 * Architecture:
 *   CloudFront Distribution
 *     └─ Viewer Response trigger → this Lambda@Edge function
 *          └─ Reads critical CSS from S3 (cached in Lambda memory)
 *          └─ Reads hydration CSS from S3 (cached in Lambda memory)
 *          └─ Injects both <style> blocks into HTML response body
 *
 * Deployment:
 *   1. Deploy this function to AWS Lambda in us-east-1 (required for Lambda@Edge).
 *   2. Publish a version (Lambda@Edge requires a numbered version, not $LATEST).
 *   3. Associate the published version ARN with the CloudFront distribution's
 *      "Viewer Response" event for the default cache behaviour (or the behaviour
 *      that serves *.html / index.html).
 *   4. Set the following environment variables on the Lambda function:
 *        S3_BUCKET             — name of the S3 bucket hosting the built assets
 *        S3_CRITICAL_KEY       — S3 object key for the critical CSS file
 *                                (default: assets/css/critical.css)
 *        S3_HYDRATION_KEY      — S3 object key for the hydration CSS file
 *                                (default: assets/css/client-hydration.css)
 *        AWS_REGION            — AWS region of the S3 bucket (default: us-east-1)
 *
 * Critical CSS build step (CI/CD):
 *   npm run extract-critical
 *   aws s3 cp assets/css/critical.css s3://${S3_BUCKET}/assets/css/critical.css
 *   aws cloudfront create-invalidation --distribution-id ${CF_DIST_ID} \
 *       --paths "/assets/css/critical.css"
 *
 * Hydration CSS build step (CI/CD — cr-css-1008 remediation):
 *   npm run build:css:hydration
 *   aws s3 cp dist/css/client-hydration.css \
 *       s3://${S3_BUCKET}/assets/css/client-hydration.css \
 *       --cache-control "max-age=86400"
 *   aws cloudfront create-invalidation --distribution-id ${CF_DIST_ID} \
 *       --paths "/assets/css/client-hydration.css"
 *
 * IAM permissions required by the Lambda execution role:
 *   {
 *     "Effect": "Allow",
 *     "Action": ["s3:GetObject"],
 *     "Resource": [
 *       "arn:aws:s3:::${S3_BUCKET}/assets/css/critical.css",
 *       "arn:aws:s3:::${S3_BUCKET}/assets/css/client-hydration.css"
 *     ]
 *   }
 *
 * Note: Lambda@Edge functions cannot use environment variables directly at
 * execution time (they are stripped at association). Embed the S3 bucket name
 * and key as constants below, or use SSM Parameter Store via the AWS SDK.
 */

'use strict';

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

// ---------------------------------------------------------------------------
// Configuration — update these values at deploy time or inject via build step
// ---------------------------------------------------------------------------
const S3_BUCKET = process.env.S3_BUCKET || 'REPLACE_WITH_YOUR_S3_BUCKET_NAME';
const S3_CRITICAL_KEY = process.env.S3_CRITICAL_KEY || 'assets/css/critical.css';
const S3_HYDRATION_KEY = process.env.S3_HYDRATION_KEY || 'assets/css/client-hydration.css';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// ---------------------------------------------------------------------------
// Module-level cache — Lambda@Edge reuses the execution environment between
// invocations within the same edge location, so caching the CSS strings
// avoids an S3 round-trip on every request.
// ---------------------------------------------------------------------------
let cachedCriticalCss = null;
let criticalCacheTimestamp = 0;

let cachedHydrationCss = null;
let hydrationCacheTimestamp = 0;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — refresh after CloudFront invalidation

const s3Client = new S3Client({ region: AWS_REGION });

/**
 * Fetch a CSS string from S3, using the module-level cache keyed by S3 object key.
 * @param {string} s3Key - The S3 object key to fetch.
 * @param {string|null} cachedValue - The currently cached CSS string (or null).
 * @param {number} cacheTs - The timestamp when the cache was last populated.
 * @returns {Promise<{ css: string, newCache: string, newTs: number }>}
 */
async function fetchCssFromS3(s3Key, cachedValue, cacheTs) {
  const now = Date.now();
  if (cachedValue && (now - cacheTs) < CACHE_TTL_MS) {
    return { css: cachedValue, newCache: cachedValue, newTs: cacheTs };
  }

  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
  });

  const response = await s3Client.send(command);

  // Stream the S3 object body to a string
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  const cssContent = Buffer.concat(chunks).toString('utf-8');

  return { css: cssContent, newCache: cssContent, newTs: now };
}

/**
 * Fetch the critical CSS string from S3, using the module-level cache.
 * @returns {Promise<string>} The critical CSS content.
 */
async function getCriticalCss() {
  const result = await fetchCssFromS3(S3_CRITICAL_KEY, cachedCriticalCss, criticalCacheTimestamp);
  cachedCriticalCss = result.newCache;
  criticalCacheTimestamp = result.newTs;
  return result.css;
}

/**
 * Fetch the hydration CSS string from S3, using the module-level cache.
 *
 * CLOUD READINESS FIX (cr-css-1008): Client-Only CSS Loaded After Hydration
 *
 * Previously, the styles in assets/css/client-hydration.css were only injected
 * after client-side JavaScript hydration, causing FOUC on SSR pages. By fetching
 * this stylesheet from S3 and inlining it at the Lambda@Edge layer, the styles
 * are present in the server-rendered HTML from the very first byte, eliminating
 * the style mismatch between server-rendered and client-hydrated content.
 *
 * @returns {Promise<string>} The hydration CSS content.
 */
async function getHydrationCss() {
  const result = await fetchCssFromS3(S3_HYDRATION_KEY, cachedHydrationCss, hydrationCacheTimestamp);
  cachedHydrationCss = result.newCache;
  hydrationCacheTimestamp = result.newTs;
  return result.css;
}

/**
 * Lambda@Edge viewer-response handler.
 *
 * Injects critical CSS and hydration CSS inline into HTML responses by replacing:
 *   <!-- LAMBDA_EDGE_CRITICAL_CSS_PLACEHOLDER -->  → <style id="critical-css-edge">
 *   <!-- LAMBDA_EDGE_HYDRATION_CSS_PLACEHOLDER -->  → <style id="hydration-css-edge">
 *
 * @param {Object} event  - CloudFront viewer-response event
 * @param {Object} context - Lambda context
 * @returns {Object} Modified CloudFront response
 */
exports.handler = async (event, context) => {
  const { request, response } = event.Records[0].cf;

  // Only process HTML responses — pass through all other content types unchanged
  const contentType = (response.headers['content-type'] || [{ value: '' }])[0].value;
  if (!contentType.includes('text/html')) {
    return response;
  }

  // Lambda@Edge encodes the response body in base64 when bodyEncoding is 'base64'
  let body = response.body || '';
  if (response.bodyEncoding === 'base64') {
    body = Buffer.from(body, 'base64').toString('utf-8');
  }

  const CRITICAL_PLACEHOLDER = '<!-- LAMBDA_EDGE_CRITICAL_CSS_PLACEHOLDER -->';
  const HYDRATION_PLACEHOLDER = '<!-- LAMBDA_EDGE_HYDRATION_CSS_PLACEHOLDER -->';

  const hasCriticalPlaceholder = body.includes(CRITICAL_PLACEHOLDER);
  const hasHydrationPlaceholder = body.includes(HYDRATION_PLACEHOLDER);

  // If neither placeholder is present, return the response unmodified
  if (!hasCriticalPlaceholder && !hasHydrationPlaceholder) {
    return response;
  }

  let modifiedBody = body;

  // -------------------------------------------------------------------------
  // Inject critical CSS (cr-css-1002)
  // -------------------------------------------------------------------------
  if (hasCriticalPlaceholder) {
    let criticalCss;
    try {
      criticalCss = await getCriticalCss();
    } catch (err) {
      // If S3 fetch fails, log the error and leave the placeholder unreplaced.
      // The static fallback <style id="critical-css"> in index.html will be used.
      console.error(
        JSON.stringify({
          level: 'ERROR',
          message: 'Lambda@Edge: Failed to fetch critical CSS from S3',
          bucket: S3_BUCKET,
          key: S3_CRITICAL_KEY,
          error: err.message,
          requestId: context.awsRequestId,
          uri: request.uri,
        })
      );
      criticalCss = null;
    }

    if (criticalCss !== null) {
      const inlineCriticalBlock = [
        '<style id="critical-css-edge">',
        '/*',
        ' * Critical CSS injected inline by Lambda@Edge (cr-css-1002 remediation).',
        ' * Source: s3://' + S3_BUCKET + '/' + S3_CRITICAL_KEY,
        ' * Injected at: ' + new Date().toISOString(),
        ' * This block eliminates render-blocking external CSS requests for above-fold content.',
        ' */',
        criticalCss,
        '</style>',
      ].join('\n');

      modifiedBody = modifiedBody.replace(CRITICAL_PLACEHOLDER, inlineCriticalBlock);
      // Remove the static fallback <style id="critical-css"> block to avoid duplication
      modifiedBody = modifiedBody.replace(
        /<style id="critical-css">[\s\S]*?<\/style>/,
        '<!-- critical-css: replaced by Lambda@Edge inline injection -->'
      );

      console.log(
        JSON.stringify({
          level: 'INFO',
          message: 'Lambda@Edge: Critical CSS injected inline',
          uri: request.uri,
          criticalCssSizeBytes: Buffer.byteLength(criticalCss, 'utf-8'),
          requestId: context.awsRequestId,
        })
      );
    }
  }

  // -------------------------------------------------------------------------
  // Inject hydration CSS (cr-css-1008)
  //
  // CLOUD READINESS FIX (cr-css-1008): Client-Only CSS Loaded After Hydration
  //
  // The hydration CSS (assets/css/client-hydration.css) was previously loaded
  // only after client-side JavaScript hydration, causing a Flash of Unstyled
  // Content (FOUC) on cloud SSR platforms. By fetching the pre-built hydration
  // CSS bundle from S3 and inlining it here at the Lambda@Edge layer, the styles
  // are present in the server-rendered HTML from the very first byte. This
  // eliminates the style mismatch between server-rendered and client-hydrated
  // content, ensuring a consistent UI across all CloudFront edge locations.
  // -------------------------------------------------------------------------
  if (hasHydrationPlaceholder) {
    let hydrationCss;
    try {
      hydrationCss = await getHydrationCss();
    } catch (err) {
      // If S3 fetch fails, log the error and leave the placeholder unreplaced.
      // The client-side deferred import in src/ui/styles.js acts as a fallback.
      console.error(
        JSON.stringify({
          level: 'ERROR',
          message: 'Lambda@Edge: Failed to fetch hydration CSS from S3',
          bucket: S3_BUCKET,
          key: S3_HYDRATION_KEY,
          error: err.message,
          requestId: context.awsRequestId,
          uri: request.uri,
        })
      );
      hydrationCss = null;
    }

    if (hydrationCss !== null) {
      const inlineHydrationBlock = [
        '<style id="hydration-css-edge">',
        '/*',
        ' * Hydration CSS injected inline by Lambda@Edge (cr-css-1008 remediation).',
        ' * Source: s3://' + S3_BUCKET + '/' + S3_HYDRATION_KEY,
        ' * Injected at: ' + new Date().toISOString(),
        ' * Previously loaded only after client-side JS hydration (causing FOUC).',
        ' * Now inlined at the SSR edge so styles are present from the first byte.',
        ' */',
        hydrationCss,
        '</style>',
      ].join('\n');

      modifiedBody = modifiedBody.replace(HYDRATION_PLACEHOLDER, inlineHydrationBlock);

      console.log(
        JSON.stringify({
          level: 'INFO',
          message: 'Lambda@Edge: Hydration CSS injected inline (cr-css-1008)',
          uri: request.uri,
          hydrationCssSizeBytes: Buffer.byteLength(hydrationCss, 'utf-8'),
          requestId: context.awsRequestId,
        })
      );
    }
  }

  // Update the response body
  response.body = modifiedBody;
  response.bodyEncoding = 'text';

  // Ensure Content-Length is updated to reflect the new body size
  const newContentLength = Buffer.byteLength(modifiedBody, 'utf-8').toString();
  response.headers['content-length'] = [{ key: 'Content-Length', value: newContentLength }];

  return response;
};
