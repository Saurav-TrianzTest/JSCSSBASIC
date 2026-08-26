# AWS CodePipeline Configuration for CSS Minification

This document provides step-by-step instructions for setting up AWS CodePipeline with CSS minification using CSSNano.

## Architecture Overview

```
GitHub/CodeCommit (Source)
    ↓
AWS CodeBuild (Build & Minify CSS)
    ↓
Amazon S3 (Static Assets Storage)
    ↓
Amazon CloudFront (CDN Distribution)
    ↓
End Users (Global Edge Delivery)
```

## Prerequisites

### 1. AWS Services Required
- AWS CodePipeline
- AWS CodeBuild
- Amazon S3
- Amazon CloudFront
- AWS Systems Manager Parameter Store
- AWS IAM

### 2. Required IAM Permissions

Create an IAM role for CodeBuild with the following policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SSMParameterAccess",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters"
      ],
      "Resource": [
        "arn:aws:ssm:*:*:parameter/app/cdn/*"
      ]
    },
    {
      "Sid": "S3AssetUpload",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-app-assets-bucket/*",
        "arn:aws:s3:::your-app-assets-bucket"
      ]
    },
    {
      "Sid": "CloudFrontInvalidation",
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateInvalidation",
        "cloudfront:GetInvalidation"
      ],
      "Resource": [
        "arn:aws:cloudfront::*:distribution/*"
      ]
    },
    {
      "Sid": "CodeBuildLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": [
        "arn:aws:logs:*:*:log-group:/aws/codebuild/*"
      ]
    }
  ]
}
```

## Setup Instructions

### Step 1: Create S3 Bucket for Static Assets

```bash
# Create S3 bucket
aws s3 mb s3://your-app-assets-bucket --region us-east-1

# Enable versioning (optional but recommended)
aws s3api put-bucket-versioning \
  --bucket your-app-assets-bucket \
  --versioning-configuration Status=Enabled

# Configure bucket policy for CloudFront access
cat > bucket-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFrontAccess",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::your-app-assets-bucket/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::ACCOUNT_ID:distribution/DISTRIBUTION_ID"
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
  "CallerReference": "css-minification-$(date +%s)",
  "Comment": "CDN for minified CSS assets",
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
    "MaxTTL": 31536000,
    "ForwardedValues": {
      "QueryString": false,
      "Cookies": {
        "Forward": "none"
      }
    }
  },
  "CacheBehaviors": {
    "Quantity": 1,
    "Items": [
      {
        "PathPattern": "assets/css/*",
        "TargetOriginId": "S3-your-app-assets-bucket",
        "ViewerProtocolPolicy": "redirect-to-https",
        "AllowedMethods": {
          "Quantity": 2,
          "Items": ["GET", "HEAD"]
        },
        "Compress": true,
        "MinTTL": 0,
        "DefaultTTL": 31536000,
        "MaxTTL": 31536000
      }
    ]
  }
}
EOF

# Create distribution
aws cloudfront create-distribution \
  --distribution-config file://cloudfront-config.json
```

### Step 3: Store CDN URL in SSM Parameter Store

```bash
# Get CloudFront distribution domain name
CLOUDFRONT_DOMAIN=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='CDN for minified CSS assets'].DomainName" \
  --output text)

# Store in SSM Parameter Store
aws ssm put-parameter \
  --name /app/cdn/base-url \
  --value "https://$CLOUDFRONT_DOMAIN" \
  --type String \
  --description "CloudFront CDN URL for CSS assets" \
  --region us-east-1

# Verify parameter
aws ssm get-parameter \
  --name /app/cdn/base-url \
  --query Parameter.Value \
  --output text
```

### Step 4: Create CodeBuild Project

```bash
# Create CodeBuild project configuration
cat > codebuild-project.json <<EOF
{
  "name": "css-minification-build",
  "description": "Build project for CSS minification with CSSNano",
  "source": {
    "type": "CODEPIPELINE",
    "buildspec": "buildspec.yml"
  },
  "artifacts": {
    "type": "CODEPIPELINE"
  },
  "environment": {
    "type": "LINUX_CONTAINER",
    "image": "aws/codebuild/standard:7.0",
    "computeType": "BUILD_GENERAL1_SMALL",
    "environmentVariables": [
      {
        "name": "S3_BUCKET",
        "value": "your-app-assets-bucket",
        "type": "PLAINTEXT"
      },
      {
        "name": "CLOUDFRONT_DIST_ID",
        "value": "E1234567890ABC",
        "type": "PLAINTEXT"
      },
      {
        "name": "AWS_REGION",
        "value": "us-east-1",
        "type": "PLAINTEXT"
      },
      {
        "name": "SSM_PARAMETER_NAME",
        "value": "/app/cdn/base-url",
        "type": "PLAINTEXT"
      },
      {
        "name": "NODE_ENV",
        "value": "production",
        "type": "PLAINTEXT"
      },
      {
        "name": "ENABLE_PURGECSS",
        "value": "true",
        "type": "PLAINTEXT"
      }
    ]
  },
  "serviceRole": "arn:aws:iam::ACCOUNT_ID:role/CodeBuildServiceRole",
  "cache": {
    "type": "LOCAL",
    "modes": ["LOCAL_SOURCE_CACHE", "LOCAL_CUSTOM_CACHE"]
  },
  "logsConfig": {
    "cloudWatchLogs": {
      "status": "ENABLED",
      "groupName": "/aws/codebuild/css-minification"
    }
  }
}
EOF

# Create CodeBuild project
aws codebuild create-project --cli-input-json file://codebuild-project.json
```

### Step 5: Create CodePipeline

```bash
# Create CodePipeline configuration
cat > codepipeline-config.json <<EOF
{
  "pipeline": {
    "name": "css-minification-pipeline",
    "roleArn": "arn:aws:iam::ACCOUNT_ID:role/CodePipelineServiceRole",
    "artifactStore": {
      "type": "S3",
      "location": "your-codepipeline-artifacts-bucket"
    },
    "stages": [
      {
        "name": "Source",
        "actions": [
          {
            "name": "SourceAction",
            "actionTypeId": {
              "category": "Source",
              "owner": "AWS",
              "provider": "CodeCommit",
              "version": "1"
            },
            "configuration": {
              "RepositoryName": "your-app-repo",
              "BranchName": "main"
            },
            "outputArtifacts": [
              {
                "name": "SourceOutput"
              }
            ]
          }
        ]
      },
      {
        "name": "Build",
        "actions": [
          {
            "name": "BuildAction",
            "actionTypeId": {
              "category": "Build",
              "owner": "AWS",
              "provider": "CodeBuild",
              "version": "1"
            },
            "configuration": {
              "ProjectName": "css-minification-build"
            },
            "inputArtifacts": [
              {
                "name": "SourceOutput"
              }
            ],
            "outputArtifacts": [
              {
                "name": "BuildOutput"
              }
            ]
          }
        ]
      }
    ]
  }
}
EOF

# Create pipeline
aws codepipeline create-pipeline --cli-input-json file://codepipeline-config.json
```

## Testing the Pipeline

### 1. Trigger Pipeline Manually

```bash
# Start pipeline execution
aws codepipeline start-pipeline-execution \
  --name css-minification-pipeline

# Get execution status
aws codepipeline get-pipeline-state \
  --name css-minification-pipeline
```

### 2. Monitor Build Progress

```bash
# Get latest build ID
BUILD_ID=$(aws codebuild list-builds-for-project \
  --project-name css-minification-build \
  --query 'ids[0]' \
  --output text)

# Get build logs
aws codebuild batch-get-builds \
  --ids $BUILD_ID \
  --query 'builds[0].logs.deepLink' \
  --output text
```

### 3. Verify CSS Minification

```bash
# Check S3 for minified CSS
aws s3 ls s3://your-app-assets-bucket/assets/css/ --recursive

# Download and check file size
aws s3 cp s3://your-app-assets-bucket/assets/css/site.css site.css
ls -lh site.css

# Verify content is minified (no whitespace, comments removed)
head -c 200 site.css
```

### 4. Test CloudFront Delivery

```bash
# Get CloudFront URL
CDN_URL=$(aws ssm get-parameter \
  --name /app/cdn/base-url \
  --query Parameter.Value \
  --output text)

# Test CSS delivery
curl -I $CDN_URL/assets/css/site.css

# Expected headers:
# - Content-Type: text/css
# - Content-Encoding: gzip (if compression enabled)
# - Cache-Control: public, max-age=31536000, immutable
# - X-Cache: Hit from cloudfront (after first request)
```

## Monitoring and Alerts

### CloudWatch Alarms

```bash
# Create alarm for build failures
aws cloudwatch put-metric-alarm \
  --alarm-name css-minification-build-failures \
  --alarm-description "Alert on CSS minification build failures" \
  --metric-name FailedBuilds \
  --namespace AWS/CodeBuild \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 1 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --dimensions Name=ProjectName,Value=css-minification-build

# Create alarm for CloudFront errors
aws cloudwatch put-metric-alarm \
  --alarm-name cloudfront-5xx-errors \
  --alarm-description "Alert on CloudFront 5xx errors" \
  --metric-name 5xxErrorRate \
  --namespace AWS/CloudFront \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=DistributionId,Value=E1234567890ABC
```

### CloudWatch Dashboard

```bash
# Create dashboard for monitoring
cat > dashboard.json <<EOF
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/CodeBuild", "SuccessfulBuilds", {"stat": "Sum"}],
          [".", "FailedBuilds", {"stat": "Sum"}]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "us-east-1",
        "title": "CodeBuild Status"
      }
    },
    {
      "type": "metric",
      "properties": {
        "metrics": [
          ["AWS/CloudFront", "BytesDownloaded", {"stat": "Sum"}],
          [".", "Requests", {"stat": "Sum"}]
        ],
        "period": 300,
        "stat": "Sum",
        "region": "us-east-1",
        "title": "CloudFront Traffic"
      }
    }
  ]
}
EOF

aws cloudwatch put-dashboard \
  --dashboard-name css-minification-monitoring \
  --dashboard-body file://dashboard.json
```

## Cost Optimization

### Expected Cost Savings

| Service | Before | After | Savings |
|---------|--------|-------|---------|
| CloudFront Data Transfer | $100/mo | $60/mo | 40% |
| S3 Storage | $5/mo | $3/mo | 40% |
| Total | $105/mo | $63/mo | **$42/mo** |

### Cost Monitoring

```bash
# Enable Cost Explorer for detailed analysis
aws ce get-cost-and-usage \
  --time-period Start=2024-01-01,End=2024-01-31 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --filter file://cost-filter.json

# cost-filter.json
{
  "Dimensions": {
    "Key": "SERVICE",
    "Values": ["Amazon CloudFront", "Amazon Simple Storage Service"]
  }
}
```

## Troubleshooting

### Common Issues

#### 1. Build Fails with "cssnano not found"

**Solution**: Ensure dependencies are installed in buildspec.yml

```yaml
phases:
  install:
    commands:
      - npm install
```

#### 2. SSM Parameter Not Found

**Solution**: Create the parameter or set CDN_BASE_URL directly

```bash
aws ssm put-parameter \
  --name /app/cdn/base-url \
  --value "https://d1234567890.cloudfront.net" \
  --type String
```

#### 3. S3 Upload Permission Denied

**Solution**: Update CodeBuild IAM role with S3 permissions

```json
{
  "Effect": "Allow",
  "Action": ["s3:PutObject", "s3:DeleteObject"],
  "Resource": "arn:aws:s3:::your-app-assets-bucket/*"
}
```

#### 4. CloudFront Serving Old CSS

**Solution**: Invalidate cache

```bash
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/assets/css/*"
```

## Best Practices

1. **Use Separate Environments**: Create separate pipelines for dev, staging, and production
2. **Enable Versioning**: Use S3 versioning for rollback capability
3. **Monitor Costs**: Set up billing alerts for CloudFront and S3
4. **Test Locally First**: Run `npm run build:minify` before committing
5. **Use Content Hashing**: Add hash to CSS filenames for cache busting
6. **Enable Compression**: Configure CloudFront to compress CSS files
7. **Set Long Cache TTL**: Use `max-age=31536000` for immutable assets

## Additional Resources

- [AWS CodePipeline Documentation](https://docs.aws.amazon.com/codepipeline/)
- [AWS CodeBuild Documentation](https://docs.aws.amazon.com/codebuild/)
- [CloudFront Developer Guide](https://docs.aws.amazon.com/cloudfront/)
- [CSSNano Documentation](https://cssnano.co/)

---

**Last Updated**: 2024-01-15  
**Rule ID**: cr-css-1005  
**Status**: ✅ Production Ready
