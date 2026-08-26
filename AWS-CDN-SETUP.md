# AWS CloudFront CDN Configuration Guide

## Overview

This guide explains how to configure AWS CloudFront CDN for serving static assets referenced in CSS files. The application has been updated to use environment-agnostic CDN URLs that are replaced at build time.

## Cloud Readiness Fix Applied

**Rule ID**: cr-css-0006  
**Rule Name**: Hardcoded Server Names in CSS URLs  
**Severity**: MEDIUM  
**Category**: configuration-management

### Changes Made

1. **CSS Files Updated** (`assets/css/site.css`):
   - Replaced hardcoded server path `/opt/app/static/img/header.svg` with `CDN_BASE_URL/img/header.svg`
   - Replaced hardcoded staging URL `https://staging-assets.local/img/bg.jpg` with `CDN_BASE_URL/img/bg.jpg`
   - Added comprehensive documentation for build-time variable substitution

2. **Build Configuration Added**:
   - `postcss.config.js`: PostCSS configuration for CDN URL replacement
   - `build-with-cdn.js`: Build script with AWS SSM Parameter Store integration

## AWS Setup Instructions

### Step 1: Create S3 Bucket for Static Assets

```bash
# Create S3 bucket
aws s3 mb s3://your-app-assets-bucket --region us-east-1

# Enable versioning (recommended)
aws s3api put-bucket-versioning \
  --bucket your-app-assets-bucket \
  --versioning-configuration Status=Enabled

# Configure bucket policy for CloudFront access
cat > bucket-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontAccess",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::your-app-assets-bucket/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::YOUR_ACCOUNT_ID:distribution/YOUR_DISTRIBUTION_ID"
        }
      }
    }
  ]
}
EOF

aws s3api put-bucket-policy \
  --bucket your-app-assets-bucket \
  --policy file://bucket-policy.json
```

### Step 2: Create CloudFront Distribution

```bash
# Create CloudFront distribution configuration
cat > cloudfront-config.json <<EOF
{
  "CallerReference": "$(date +%s)",
  "Comment": "CDN for application static assets",
  "Enabled": true,
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "S3-your-app-assets-bucket",
        "DomainName": "your-app-assets-bucket.s3.us-east-1.amazonaws.com",
        "S3OriginConfig": {
          "OriginAccessIdentity": ""
        },
        "OriginAccessControlId": "YOUR_OAC_ID"
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "S3-your-app-assets-bucket",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 2,
      "Items": ["GET", "HEAD"]
    },
    "CachedMethods": {
      "Quantity": 2,
      "Items": ["GET", "HEAD"]
    },
    "Compress": true,
    "MinTTL": 0,
    "DefaultTTL": 86400,
    "MaxTTL": 31536000
  }
}
EOF

# Create the distribution
aws cloudfront create-distribution \
  --distribution-config file://cloudfront-config.json
```

### Step 3: Store CloudFront URL in SSM Parameter Store

```bash
# Get your CloudFront distribution domain name
CLOUDFRONT_DOMAIN=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='CDN for application static assets'].DomainName" \
  --output text)

# Store in SSM Parameter Store
aws ssm put-parameter \
  --name /app/cdn/base-url \
  --value "https://${CLOUDFRONT_DOMAIN}" \
  --type String \
  --description "CloudFront CDN base URL for static assets" \
  --region us-east-1

# Verify the parameter
aws ssm get-parameter \
  --name /app/cdn/base-url \
  --query Parameter.Value \
  --output text
```

### Step 4: Upload Static Assets to S3

```bash
# Upload assets with appropriate cache headers
aws s3 sync ./assets s3://your-app-assets-bucket/assets \
  --cache-control "public, max-age=31536000, immutable" \
  --metadata-directive REPLACE

# Upload fonts with longer cache
aws s3 sync ./assets/fonts s3://your-app-assets-bucket/assets/fonts \
  --cache-control "public, max-age=31536000, immutable" \
  --content-type "font/woff2"

# Upload images
aws s3 sync ./assets/img s3://your-app-assets-bucket/assets/img \
  --cache-control "public, max-age=31536000, immutable"
```

### Step 5: Configure IAM Permissions

Create an IAM policy for your build/deployment process:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters"
      ],
      "Resource": [
        "arn:aws:ssm:us-east-1:YOUR_ACCOUNT_ID:parameter/app/cdn/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-app-assets-bucket",
        "arn:aws:s3:::your-app-assets-bucket/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateInvalidation",
        "cloudfront:GetInvalidation"
      ],
      "Resource": [
        "arn:aws:cloudfront::YOUR_ACCOUNT_ID:distribution/*"
      ]
    }
  ]
}
```

## Build Process

### Option 1: Using the Build Script (Recommended)

```bash
# Install dependencies
npm install postcss postcss-url autoprefixer cssnano

# Run build with SSM integration
node build-with-cdn.js

# Or set CDN URL directly
CDN_BASE_URL=https://d1234567890.cloudfront.net node build-with-cdn.js
```

### Option 2: Manual Environment Variable

```bash
# Set environment variable
export CDN_BASE_URL=https://d1234567890.cloudfront.net

# Run your build process
npm run build
```

### Option 3: CI/CD Pipeline Integration

```yaml
# Example GitHub Actions workflow
name: Build and Deploy

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      
      - name: Get CDN URL from SSM
        run: |
          CDN_URL=$(aws ssm get-parameter --name /app/cdn/base-url --query Parameter.Value --output text)
          echo "CDN_BASE_URL=$CDN_URL" >> $GITHUB_ENV
      
      - name: Build application
        run: |
          npm install
          node build-with-cdn.js
      
      - name: Upload assets to S3
        run: |
          aws s3 sync ./assets s3://your-app-assets-bucket/assets --delete
      
      - name: Invalidate CloudFront cache
        run: |
          aws cloudfront create-invalidation \
            --distribution-id YOUR_DISTRIBUTION_ID \
            --paths "/*"
```

## Environment-Specific Configuration

### Development
```bash
# Use relative paths (no CDN)
export CDN_BASE_URL=""
npm run build
```

### Staging
```bash
# Use staging CloudFront distribution
export CDN_BASE_URL="https://staging-cdn.example.com"
npm run build
```

### Production
```bash
# Retrieve from SSM Parameter Store
node build-with-cdn.js
```

## Verification

### 1. Verify CSS Processing
```bash
# Check that CDN_BASE_URL was replaced
grep -n "CDN_BASE_URL" assets/css/site.css
# Should return no results after build

# Check that CloudFront URL is present
grep -n "cloudfront.net" assets/css/site.css
# Should show the replaced URLs
```

### 2. Test Asset Loading
```bash
# Test image URL
curl -I https://d1234567890.cloudfront.net/assets/img/header.svg

# Should return 200 OK with CloudFront headers
```

### 3. Monitor CloudFront
```bash
# Check CloudFront cache statistics
aws cloudfront get-distribution-config \
  --id YOUR_DISTRIBUTION_ID \
  --query "DistributionConfig.DefaultCacheBehavior"
```

## Troubleshooting

### Issue: CDN_BASE_URL not replaced in CSS
**Solution**: Ensure the build script runs before deployment
```bash
node build-with-cdn.js
```

### Issue: 403 Forbidden from CloudFront
**Solution**: Check S3 bucket policy and CloudFront Origin Access Control
```bash
aws s3api get-bucket-policy --bucket your-app-assets-bucket
```

### Issue: Assets not loading
**Solution**: Verify assets are uploaded to S3
```bash
aws s3 ls s3://your-app-assets-bucket/assets/ --recursive
```

### Issue: SSM parameter not found
**Solution**: Create the parameter
```bash
aws ssm put-parameter \
  --name /app/cdn/base-url \
  --value "https://d1234567890.cloudfront.net" \
  --type String
```

## Cost Optimization

1. **Enable CloudFront Compression**: Reduces data transfer costs
2. **Set Appropriate Cache TTLs**: Reduces origin requests
3. **Use S3 Lifecycle Policies**: Archive old asset versions
4. **Monitor CloudFront Usage**: Use AWS Cost Explorer

## Security Best Practices

1. **Use HTTPS Only**: Set `ViewerProtocolPolicy` to `redirect-to-https`
2. **Enable Origin Access Control**: Restrict direct S3 access
3. **Implement WAF Rules**: Protect against common attacks
4. **Use Signed URLs**: For sensitive assets (if needed)
5. **Enable CloudFront Logging**: Monitor access patterns

## Next Steps

1. ✅ CSS files updated with CDN_BASE_URL placeholders
2. ✅ Build scripts created for AWS SSM integration
3. ⏳ Create S3 bucket and CloudFront distribution
4. ⏳ Store CloudFront URL in SSM Parameter Store
5. ⏳ Upload assets to S3
6. ⏳ Run build process with CDN URL
7. ⏳ Deploy application to AWS
8. ⏳ Test asset loading from CloudFront

## Additional Resources

- [AWS CloudFront Documentation](https://docs.aws.amazon.com/cloudfront/)
- [AWS SSM Parameter Store](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)
- [S3 Static Website Hosting](https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteHosting.html)
- [CloudFront Best Practices](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/best-practices.html)
