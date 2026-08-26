#!/usr/bin/env node

/**
 * Build Script with AWS SSM Parameter Store Integration
 * 
 * This script retrieves the CloudFront CDN URL from AWS SSM Parameter Store
 * and sets it as an environment variable for the build process.
 * 
 * Prerequisites:
 *   - AWS CLI configured with appropriate credentials
 *   - IAM permissions: ssm:GetParameter
 *   - SSM parameter created: /app/cdn/base-url
 * 
 * Usage:
 *   node build-with-cdn.js
 * 
 * Environment Variables:
 *   - AWS_REGION: AWS region (default: us-east-1)
 *   - SSM_PARAMETER_NAME: SSM parameter name (default: /app/cdn/base-url)
 *   - CDN_BASE_URL: Override SSM with direct URL (optional)
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const SSM_PARAMETER_NAME = process.env.SSM_PARAMETER_NAME || '/app/cdn/base-url';

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
 * Process CSS files and replace CDN_BASE_URL placeholder
 */
function processCssFiles(cdnUrl) {
  const cssFiles = [
    'assets/css/site.css'
  ];
  
  console.log('\nProcessing CSS files...');
  
  cssFiles.forEach(file => {
    try {
      const filePath = join(process.cwd(), file);
      let content = readFileSync(filePath, 'utf-8');
      
      // Replace CDN_BASE_URL placeholder with actual URL
      const originalContent = content;
      content = content.replace(/CDN_BASE_URL/g, cdnUrl);
      
      if (content !== originalContent) {
        writeFileSync(filePath, content, 'utf-8');
        console.log(`✓ Processed: ${file}`);
      } else {
        console.log(`  Skipped: ${file} (no changes needed)`);
      }
    } catch (error) {
      console.error(`✗ Failed to process ${file}: ${error.message}`);
    }
  });
}

/**
 * Main build process
 */
function main() {
  console.log('='.repeat(60));
  console.log('AWS CloudFront CDN Build Process');
  console.log('='.repeat(60));
  
  // Get CDN URL from SSM or environment variable
  const cdnUrl = process.env.CDN_BASE_URL || getCdnUrlFromSSM();
  
  if (!cdnUrl) {
    console.warn('\n⚠ WARNING: No CDN URL configured. Using relative paths.');
    console.warn('  Set CDN_BASE_URL environment variable or configure SSM parameter.');
  }
  
  // Process CSS files
  processCssFiles(cdnUrl);
  
  console.log('\n' + '='.repeat(60));
  console.log('Build completed successfully!');
  console.log('='.repeat(60));
  console.log('\nNext steps:');
  console.log('  1. Upload assets to S3: aws s3 sync ./assets s3://your-bucket/assets');
  console.log('  2. Invalidate CloudFront cache: aws cloudfront create-invalidation --distribution-id YOUR_DIST_ID --paths "/*"');
  console.log('  3. Deploy application to AWS (ECS, Lambda, etc.)');
}

// Run the build process
main();
