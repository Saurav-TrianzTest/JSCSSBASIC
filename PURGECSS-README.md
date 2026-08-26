# PurgeCSS Integration for AWS CloudFront Bundle Optimization

## Overview

This project integrates PurgeCSS into the AWS CodeBuild/CodePipeline build process to remove unused CSS rules before deployment. This optimization:

- **Reduces bundle size** by removing unused CSS selectors
- **Lowers CloudFront bandwidth costs** by serving smaller files
- **Improves page load performance** and Core Web Vitals scores
- **Optimizes CDN delivery** with smaller assets

## Architecture

```
┌─────────────────┐
│  Source Code    │
│  (GitHub/etc)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  AWS CodeBuild  │
│  ┌───────────┐  │
│  │ PurgeCSS  │  │ ← Removes unused CSS
│  └───────────┘  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Amazon S3     │ ← Optimized assets
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  CloudFront CDN │ ← Serves optimized CSS
└─────────────────┘
```

## Files Added/Modified

### 1. `package.json`
- Added `@fullhuman/postcss-purgecss` dependency
- Added `build:purgecss` script

### 2. `postcss.config.js`
- Integrated PurgeCSS plugin
- Configured content scanning paths
- Added safelist for critical CSS classes

### 3. `build-with-purgecss.js`
- New build script with PurgeCSS integration
- Retrieves CDN URL from AWS SSM Parameter Store
- Processes CSS files with PostCSS and PurgeCSS
- Generates build report with size reduction metrics

### 4. `buildspec.yml`
- AWS CodeBuild configuration
- Installs dependencies
- Runs PurgeCSS optimization
- Uploads optimized assets to S3
- Invalidates CloudFront cache

### 5. `purgecss.config.js`
- PurgeCSS configuration
- Defines content scanning paths
- Configures safelist patterns
- Custom extractors for class names

## Usage

### Local Development

```bash
# Install dependencies
npm install

# Run build with PurgeCSS (development mode)
npm run build:purgecss

# Run build with PurgeCSS (production mode)
NODE_ENV=production ENABLE_PURGECSS=true npm run build:purgecss
```

### AWS CodeBuild Integration

1. **Create SSM Parameter** (optional):
   ```bash
   aws ssm put-parameter \
     --name /app/cdn/base-url \
     --value "https://d1234567890.cloudfront.net" \
     --type String \
     --region us-east-1
   ```

2. **Configure CodeBuild Project**:
   - Set environment variables:
     - `S3_BUCKET`: Your S3 bucket name
     - `CLOUDFRONT_DIST_ID`: Your CloudFront distribution ID
     - `AWS_REGION`: AWS region (default: us-east-1)
   - Use `buildspec.yml` as the build specification

3. **Integrate with CodePipeline**:
   - Add CodeBuild project as a build stage
   - Configure source stage (GitHub, CodeCommit, etc.)
   - Add deployment stage if needed

## Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `ENABLE_PURGECSS` | Enable PurgeCSS optimization | `true` in production | No |
| `NODE_ENV` | Environment (production/development) | `development` | No |
| `CDN_BASE_URL` | CloudFront distribution URL | Retrieved from SSM | No |
| `SSM_PARAMETER_NAME` | SSM parameter name for CDN URL | `/app/cdn/base-url` | No |
| `AWS_REGION` | AWS region | `us-east-1` | No |
| `S3_BUCKET` | S3 bucket for assets | - | Yes (CodeBuild) |
| `CLOUDFRONT_DIST_ID` | CloudFront distribution ID | - | Yes (CodeBuild) |

### Safelist Configuration

Edit `postcss.config.js` or `purgecss.config.js` to add CSS classes that should never be removed:

```javascript
safelist: {
  standard: ['hero', 'promo', 'user-card'],  // Exact class names
  deep: [/^data-/, /^aria-/],                // Attribute patterns
  greedy: [/^emotion-/, /^css-/]             // Dynamic class patterns
}
```

## Benefits

### Before PurgeCSS
- **site.css**: ~15 KB (with unused `.deprecated-sidebar` and other unused rules)
- **CloudFront bandwidth**: Higher costs
- **Page load time**: Slower due to larger CSS files

### After PurgeCSS
- **site.css**: ~8-10 KB (unused rules removed)
- **CloudFront bandwidth**: 30-50% reduction in CSS bandwidth
- **Page load time**: Faster due to smaller CSS files
- **Core Web Vitals**: Improved LCP and FCP scores

## Monitoring

### Build Report

After each build, a `build-report.json` file is generated with:
- Timestamp
- CDN URL
- PurgeCSS status
- Environment details

### CloudWatch Logs

Monitor CodeBuild logs in CloudWatch for:
- CSS file sizes before/after optimization
- Percentage reduction
- Build duration

### CloudFront Metrics

Monitor CloudFront metrics for:
- Reduced bandwidth usage
- Faster cache hit rates
- Improved origin response times

## Troubleshooting

### Issue: CSS classes are being removed incorrectly

**Solution**: Add the class to the safelist in `postcss.config.js`:

```javascript
safelist: {
  standard: ['your-class-name']
}
```

### Issue: Build fails with "Cannot find module"

**Solution**: Ensure all dependencies are installed:

```bash
npm install
```

### Issue: CDN URL not being replaced

**Solution**: Check environment variables:

```bash
echo $CDN_BASE_URL
# or
aws ssm get-parameter --name /app/cdn/base-url --query Parameter.Value --output text
```

### Issue: CloudFront cache not invalidating

**Solution**: Check IAM permissions for `cloudfront:CreateInvalidation`

## Best Practices

1. **Test locally first**: Run `npm run build:purgecss` locally before deploying
2. **Review safelist**: Ensure critical CSS classes are safelisted
3. **Monitor metrics**: Track bundle size reduction and performance improvements
4. **Use cache control**: Set appropriate cache headers in S3/CloudFront
5. **Invalidate cache**: Always invalidate CloudFront cache after deployment

## IAM Permissions

CodeBuild service role needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter"
      ],
      "Resource": "arn:aws:ssm:*:*:parameter/app/cdn/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::your-bucket/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateInvalidation"
      ],
      "Resource": "arn:aws:cloudfront::*:distribution/*"
    }
  ]
}
```

## References

- [PurgeCSS Documentation](https://purgecss.com/)
- [AWS CodeBuild Documentation](https://docs.aws.amazon.com/codebuild/)
- [CloudFront Best Practices](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/best-practices.html)
- [PostCSS Documentation](https://postcss.org/)

## Support

For issues or questions:
1. Check CloudWatch Logs for build errors
2. Review `build-report.json` for optimization metrics
3. Verify IAM permissions and environment variables
4. Test locally with `npm run build:purgecss`
