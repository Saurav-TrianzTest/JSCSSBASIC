#!/usr/bin/env node

/**
 * ============================================================================
 * Build Script with CSS Minification (CSSNano) and PurgeCSS for AWS CodeBuild
 * ============================================================================
 * 
 * This script integrates PurgeCSS into the build pipeline to remove unused CSS
 * before uploading to S3 and serving via CloudFront. This reduces:
 *   - Bundle size
 *   - CloudFront bandwidth costs
 *   - Page load time
 * 
 * CSS MINIFICATION (cr-css-1005):
 *   - Automatically minifies CSS files using CSSNano
 *   - Reduces file size by 40-60%
 *   - Removes comments, whitespace, and optimizes selectors
 *   - Integrated into PostCSS pipeline (see postcss.config.js)
 * 
 * Prerequisites:
 *   - AWS CLI configured with appropriate credentials
 *   - IAM permissions: ssm:GetParameter, s3:PutObject
 *   - SSM parameter created: /app/cdn/base-url
 *   - PostCSS and PurgeCSS installed (see package.json)
 * 
 * Usage:
 *   node build-with-purgecss.js
 * 
 * Environment Variables:
 *   - AWS_REGION: AWS region (default: us-east-1)
 *   - SSM_PARAMETER_NAME: SSM parameter name (default: /app/cdn/base-url)
 *   - CDN_BASE_URL: Override SSM with direct URL (optional)
 *   - ENABLE_PURGECSS: Enable PurgeCSS (default: true)
 *   - NODE_ENV: Environment (production enables PurgeCSS by default)
 * 
 * AWS CodeBuild Integration:
 *   Add this to your buildspec.yml:
 *   
 *   phases:
 *     pre_build:
 *       commands:
 *         - npm install
 *     build:
 *       commands:
 *         - export NODE_ENV=production
 *         - export ENABLE_PURGECSS=true
 *         - node build-with-purgecss.js
 *     post_build:
 *       commands:
 *         - aws s3 sync ./assets s3://$S3_BUCKET/assets --delete
 *         - aws cloudfront create-invalidation --distribution-id $CLOUDFRONT_DIST_ID --paths "/*"
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import postcss from 'postcss';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const SSM_PARAMETER_NAME = process.env.SSM_PARAMETER_NAME || '/app/cdn/base-url';
const ENABLE_PURGECSS = process.env.ENABLE_PURGECSS !== 'false';

/**
 * Retrieve CDN URL from AWS SSM Parameter Store
 */
function getCdnUrlFromSSM() {
  try {
    console.log(`Retrieving CDN URL from SSM Parameter Store: ${SSM_PARAMETER_NAME}`);
    
    const command = `aws ssm get-parameter --name ${SSM_PARAMETER_NAME} --region ${AWS_REGION} --query Parameter.Value --output text`;
    const cdnUrl = execSync(command, { encoding: 'utf-8' }).trim();
    
    console.log(`✓ Retrieved CDN URL: ${cdnUrl}`);
    return cdnUrl;
  } catch (error) {
    console.warn(`⚠ Failed to retrieve CDN URL from SSM: ${error.message}`);
    console.warn('  Falling back to environment variable or empty string');
    return process.env.CDN_BASE_URL || '';
  }
}

/**
 * Process CSS files with PostCSS (includes PurgeCSS)
 */
async function processCssWithPostCSS(cssFiles, cdnUrl) {
  console.log('\nProcessing CSS files with PostCSS and PurgeCSS...');
  console.log(`CSS Minification (CSSNano): ENABLED (cr-css-1005)`);
  console.log(`PurgeCSS optimization: ${ENABLE_PURGECSS ? 'ENABLED' : 'DISABLED'}`);
  
  // Set environment variables for PostCSS config
  process.env.CDN_BASE_URL = cdnUrl;
  if (ENABLE_PURGECSS) {
    process.env.ENABLE_PURGECSS = 'true';
  }
  
  // Load PostCSS config
  const postcssConfigPath = join(__dirname, 'postcss.config.js');
  let postcssConfig;
  
  try {
    // Dynamic import for ES module
    const configModule = await import(postcssConfigPath);
    postcssConfig = configModule.default || configModule;
  } catch (error) {
    console.error(`✗ Failed to load PostCSS config: ${error.message}`);
    return;
  }
  
  // Process each CSS file
  for (const file of cssFiles) {
    try {
      const filePath = join(__dirname, file);
      
      if (!existsSync(filePath)) {
        console.warn(`  Skipped: ${file} (file not found)`);
        continue;
      }
      
      const css = readFileSync(filePath, 'utf-8');
      const originalSize = Buffer.byteLength(css, 'utf-8');
      
      // Process with PostCSS
      const result = await postcss(postcssConfig.plugins).process(css, {
        from: filePath,
        to: filePath
      });
      
      const processedSize = Buffer.byteLength(result.css, 'utf-8');
      const reduction = ((originalSize - processedSize) / originalSize * 100).toFixed(2);
      
      // Write processed CSS
      writeFileSync(filePath, result.css, 'utf-8');
      
      console.log(`\n✓ Minified: ${file}`);
      console.log(`  Original size: ${(originalSize / 1024).toFixed(2)} KB`);
      console.log(`  Minified size: ${(processedSize / 1024).toFixed(2)} KB`);
      console.log(`  Reduction: ${reduction}%`);
      
    } catch (error) {
      console.error(`✗ Failed to process ${file}: ${error.message}`);
    }
  }
}

/**
 * Generate build report
 */
function generateBuildReport(cdnUrl) {
  const report = {
    timestamp: new Date().toISOString(),
    cdnUrl: cdnUrl,
    purgeCssEnabled: ENABLE_PURGECSS,
    nodeEnv: process.env.NODE_ENV || 'development',
    awsRegion: AWS_REGION
  };
  
  const reportPath = join(__dirname, 'build-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\n✓ Build report saved: ${reportPath}`);
}

/**
 * Main build process
 */
async function main() {
  console.log('='.repeat(70));
  console.log('AWS CloudFront CDN Build Process');
  console.log('CSS Minification (CSSNano) + PurgeCSS Optimization (cr-css-1005)');
  console.log('='.repeat(70));
  
  // Get CDN URL from SSM or environment variable
  const cdnUrl = process.env.CDN_BASE_URL || getCdnUrlFromSSM();
  
  if (!cdnUrl) {
    console.warn('\n⚠ WARNING: No CDN URL configured. Using relative paths.');
    console.warn('  Set CDN_BASE_URL environment variable or configure SSM parameter.');
  }
  
  // CSS files to process
  const cssFiles = [
    'assets/css/bundle.css',
    'assets/css/site.css',
    'assets/css/client-hydration.css',
    'assets/css/brand.css',
    'assets/css/deferred.css',
    'assets/css/loader.css'
  ];
  
  // Process CSS files with PostCSS and PurgeCSS
  await processCssWithPostCSS(cssFiles, cdnUrl);
  
  // Generate build report
  generateBuildReport(cdnUrl);
  
  console.log('\n' + '='.repeat(70));
  console.log('Build completed successfully!');
  console.log('='.repeat(70));
  console.log('\nNext steps for AWS CodeBuild/CodePipeline:');
  console.log('  1. Upload minified CSS to S3:');
  console.log('     aws s3 sync ./assets s3://your-bucket/assets --delete');
  console.log('  2. Invalidate CloudFront cache:');
  console.log('     aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"');
  console.log('  3. Deploy application to AWS (ECS, Lambda, Fargate, etc.)');
  console.log('\nCSS Minification Benefits (cr-css-1005):');
  console.log('  ✓ 40-60% file size reduction');
  console.log('  ✓ Reduced bundle size');
  console.log('  ✓ Lower CloudFront bandwidth costs');
  console.log('  ✓ Faster page load times');
  console.log('  ✓ Improved Core Web Vitals scores');
}

// Run the build process
main().catch(error => {
  console.error('Build failed:', error);
  process.exit(1);
});
