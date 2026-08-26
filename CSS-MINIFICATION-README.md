# CSS Minification for AWS CloudFront Delivery

## Overview

This project integrates CSS minification into the AWS CodePipeline build process to optimize CSS delivery through CloudFront CDN. CSS files are minified using CSSNano during the build stage, reducing file size and improving performance.

## Problem Statement (cr-css-1005)

**Issue**: Non-minified CSS files in production build increase cloud bandwidth costs and slow delivery from cloud edge networks.

**Impact**:
- Increased CloudFront bandwidth costs
- Slower page load times
- Poor Core Web Vitals scores
- Inefficient CDN caching and delivery

## Solution: CSS Minification with CSSNano

### Architecture

```
Source CSS Files
    ↓
AWS CodeBuild (buildspec.yml)
    ↓
PostCSS Pipeline (postcss.config.js)
    ↓
CSSNano Minification
    ↓
Minified CSS Output
    ↓
S3 Upload
    ↓
CloudFront Distribution
    ↓
Global Edge Delivery
```

## Implementation Details

### 1. PostCSS Configuration (`postcss.config.js`)

The PostCSS configuration includes CSSNano for CSS minification:

```javascript
module.exports = {
  plugins: [
    require('postcss-url')({ /* CDN URL replacement */ }),
    require('autoprefixer'),
    require('cssnano')({
      preset: ['default', {
        discardComments: {
          removeAll: true,
        },
      }]
    })
  ]
};
```

**CSSNano Optimizations**:
- Removes comments and whitespace
- Minifies selectors and properties
- Optimizes color values (e.g., `#ffffff` → `#fff`)
- Merges duplicate rules
- Removes unused at-rules
- Normalizes values and units

### 2. Build Script (`build-with-purgecss.js`)

The build script processes CSS files through PostCSS pipeline:

```javascript
// CSS files processed during build
const cssFiles = [
  'assets/css/site.css',
  'assets/css/client-hydration.css',
  'assets/css/brand.css',
  'assets/css/deferred.css',
  'assets/css/loader.css'
];

// Process each file with PostCSS (includes CSSNano)
await processCssWithPostCSS(cssFiles, cdnUrl);
```

**Features**:
- Retrieves CDN URL from AWS SSM Parameter Store
- Processes CSS files with PostCSS and CSSNano
- Replaces CDN_BASE_URL placeholders
- Generates build report with size reduction metrics
- Logs original vs. minified file sizes

### 3. AWS CodeBuild Integration (`buildspec.yml`)

The buildspec.yml integrates CSS minification into the build pipeline:

```yaml
phases:
  build:
    commands:
      - export NODE_ENV=production
      - export ENABLE_PURGECSS=true
      - node build-with-purgecss.js
  
  post_build:
    commands:
      - aws s3 sync ./assets s3://$S3_BUCKET/assets --delete
      - aws cloudfront create-invalidation --distribution-id $CLOUDFRONT_DIST_ID --paths "/*"
```

## CSS Files Processed

### 1. `assets/css/site.css`
- Main application stylesheet
- Contains global styles, layout, and component styles
- **Minification Impact**: ~40-60% size reduction

### 2. `assets/css/client-hydration.css`
- Client-side hydration styles
- Loaded after JavaScript hydration
- **Minification Impact**: ~35-50% size reduction

### 3. `assets/css/brand.css`
- Brand-specific styles
- Typography, colors, and brand elements
- **Minification Impact**: ~30-45% size reduction

### 4. `assets/css/deferred.css`
- Deferred/lazy-loaded styles
- Below-the-fold content
- **Minification Impact**: ~35-50% size reduction

### 5. `assets/css/loader.css`
- Loading spinner and initial UI
- Critical for first paint
- **Minification Impact**: ~40-55% size reduction

## Benefits

### Performance Improvements
- **Reduced File Size**: 40-60% smaller CSS files
- **Faster Downloads**: Less data transferred over network
- **Improved TTI**: Faster Time to Interactive
- **Better Core Web Vitals**: Improved LCP and FCP scores

### Cost Savings
- **Lower CloudFront Costs**: Reduced bandwidth usage
- **Reduced S3 Storage**: Smaller file sizes
- **Fewer Cache Misses**: Smaller files = better cache hit ratio

### User Experience
- **Faster Page Loads**: Especially on mobile networks
- **Reduced Latency**: Smaller files = faster edge delivery
- **Better Mobile Performance**: Critical for 3G/4G users

## AWS CodePipeline Integration

### Prerequisites

1. **AWS Services**:
   - AWS CodePipeline
   - AWS CodeBuild
   - Amazon S3 (for static assets)
   - Amazon CloudFront (CDN distribution)
   - AWS Systems Manager Parameter Store (for CDN URL)

2. **IAM Permissions**:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "ssm:GetParameter",
           "s3:PutObject",
           "s3:DeleteObject",
           "cloudfront:CreateInvalidation"
         ],
         "Resource": "*"
       }
     ]
   }
   ```

3. **Environment Variables**:
   - `S3_BUCKET`: S3 bucket name for static assets
   - `CLOUDFRONT_DIST_ID`: CloudFront distribution ID
   - `CDN_BASE_URL`: CloudFront distribution URL (optional, retrieved from SSM)
   - `SSM_PARAMETER_NAME`: SSM parameter name (default: `/app/cdn/base-url`)
   - `AWS_REGION`: AWS region (default: `us-east-1`)

### Setup Steps

#### 1. Create SSM Parameter for CDN URL

```bash
aws ssm put-parameter \
  --name /app/cdn/base-url \
  --value "https://d1234567890.cloudfront.net" \
  --type String \
  --region us-east-1
```

#### 2. Create S3 Bucket for Static Assets

```bash
aws s3 mb s3://your-app-assets-bucket --region us-east-1
```

#### 3. Create CloudFront Distribution

```bash
# Create distribution pointing to S3 bucket
# Note: Use AWS Console or CloudFormation for full configuration
```

#### 4. Create CodeBuild Project

```bash
# Create CodeBuild project with buildspec.yml
# Configure environment variables:
#   - S3_BUCKET=your-app-assets-bucket
#   - CLOUDFRONT_DIST_ID=E1234567890ABC
#   - AWS_REGION=us-east-1
```

#### 5. Create CodePipeline

```bash
# Create pipeline with stages:
#   1. Source (GitHub/CodeCommit)
#   2. Build (CodeBuild project)
#   3. Deploy (optional, for application code)
```

## Local Development

### Running Build Locally

```bash
# Install dependencies
npm install

# Set environment variables
export CDN_BASE_URL="https://d1234567890.cloudfront.net"
export NODE_ENV=production
export ENABLE_PURGECSS=true

# Run build with CSS minification
node build-with-purgecss.js
```

### Testing Minification

```bash
# Before minification
ls -lh assets/css/site.css
# Example: 45 KB

# After minification
node build-with-purgecss.js
ls -lh assets/css/site.css
# Example: 18 KB (60% reduction)
```

### Build Report

The build script generates a `build-report.json` with metrics:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "cdnUrl": "https://d1234567890.cloudfront.net",
  "purgeCssEnabled": true,
  "nodeEnv": "production",
  "awsRegion": "us-east-1"
}
```

## Monitoring and Validation

### CloudWatch Metrics

Monitor the following CloudFront metrics:
- **BytesDownloaded**: Should decrease after minification
- **Requests**: Should remain stable
- **CacheHitRate**: Should improve with smaller files

### Performance Testing

Use these tools to validate improvements:
- **Google Lighthouse**: Check Performance score
- **WebPageTest**: Measure load times
- **Chrome DevTools**: Network tab for file sizes

### Expected Results

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| CSS File Size | 45 KB | 18 KB | 60% reduction |
| Page Load Time | 2.5s | 1.8s | 28% faster |
| CloudFront Bandwidth | 100 GB/mo | 60 GB/mo | 40% reduction |
| Lighthouse Score | 75 | 92 | +17 points |

## Troubleshooting

### Issue: CSS Not Minified

**Symptoms**: CSS files remain large after build

**Solutions**:
1. Check `NODE_ENV=production` is set
2. Verify `cssnano` is installed: `npm list cssnano`
3. Check PostCSS config: `cat postcss.config.js`
4. Run build with verbose logging: `DEBUG=* node build-with-purgecss.js`

### Issue: Build Fails in CodeBuild

**Symptoms**: Build fails with PostCSS errors

**Solutions**:
1. Check Node.js version: `nodejs: 18` in buildspec.yml
2. Verify dependencies installed: `npm install` in pre_build phase
3. Check IAM permissions for SSM Parameter Store
4. Review CodeBuild logs in CloudWatch

### Issue: CloudFront Serving Old CSS

**Symptoms**: Changes not reflected on website

**Solutions**:
1. Verify cache invalidation ran: Check CloudFront console
2. Force invalidation: `aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*"`
3. Check S3 upload: `aws s3 ls s3://$BUCKET/assets/css/`
4. Clear browser cache and test

## Best Practices

### 1. Version Control
- Commit source CSS files (unminified)
- Do NOT commit minified CSS to repository
- Minification happens during build process

### 2. Cache Busting
- Use content hashing for CSS filenames
- Set long cache headers: `max-age=31536000, immutable`
- Invalidate CloudFront cache after deployment

### 3. Monitoring
- Set up CloudWatch alarms for CloudFront metrics
- Monitor build times in CodeBuild
- Track file size reductions over time

### 4. Testing
- Test minified CSS in staging environment first
- Validate visual regression with screenshots
- Check browser compatibility

## Additional Resources

- [CSSNano Documentation](https://cssnano.co/)
- [PostCSS Documentation](https://postcss.org/)
- [AWS CodeBuild Documentation](https://docs.aws.amazon.com/codebuild/)
- [CloudFront Best Practices](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/best-practices.html)

## Support

For issues or questions:
1. Check build logs in AWS CodeBuild console
2. Review CloudWatch logs for Lambda@Edge functions
3. Verify CloudFront distribution configuration
4. Contact DevOps team for AWS infrastructure issues

---

**Last Updated**: 2024-01-15  
**Rule ID**: cr-css-1005  
**Status**: ✅ Implemented and Integrated
