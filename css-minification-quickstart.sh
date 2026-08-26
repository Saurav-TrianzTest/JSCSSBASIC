#!/bin/bash

# CSS Minification Quick Start Guide for AWS CodePipeline
# Rule: cr-css-1005 - CSS Files Not Minified for Production
# 
# This script demonstrates the CSS minification process integrated into AWS CodePipeline

set -e

echo "=========================================================================="
echo "CSS Minification for AWS CloudFront Delivery - Quick Start"
echo "=========================================================================="
echo ""

# Step 1: Prerequisites Check
echo "Step 1: Checking Prerequisites..."
echo "----------------------------------------"

# Check Node.js version
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "✓ Node.js installed: $NODE_VERSION"
else
    echo "✗ Node.js not found. Please install Node.js 18 or higher."
    exit 1
fi

# Check npm
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo "✓ npm installed: $NPM_VERSION"
else
    echo "✗ npm not found. Please install npm."
    exit 1
fi

# Check AWS CLI (optional for local testing)
if command -v aws &> /dev/null; then
    AWS_VERSION=$(aws --version)
    echo "✓ AWS CLI installed: $AWS_VERSION"
else
    echo "⚠ AWS CLI not found (optional for local testing)"
fi

echo ""

# Step 2: Install Dependencies
echo "Step 2: Installing Dependencies..."
echo "----------------------------------------"
npm install
echo "✓ Dependencies installed"
echo ""

# Step 3: Check CSS Files
echo "Step 3: Checking CSS Files..."
echo "----------------------------------------"

CSS_FILES=(
    "assets/css/site.css"
    "assets/css/client-hydration.css"
    "assets/css/brand.css"
    "assets/css/deferred.css"
    "assets/css/loader.css"
)

for file in "${CSS_FILES[@]}"; do
    if [ -f "$file" ]; then
        SIZE=$(du -h "$file" | cut -f1)
        echo "✓ Found: $file ($SIZE)"
    else
        echo "⚠ Not found: $file"
    fi
done

echo ""

# Step 4: Run CSS Minification
echo "Step 4: Running CSS Minification..."
echo "----------------------------------------"
echo "This will:"
echo "  1. Minify CSS files using CSSNano"
echo "  2. Remove unused CSS using PurgeCSS"
echo "  3. Replace CDN_BASE_URL placeholders"
echo "  4. Generate build report"
echo ""

# Set environment variables for production build
export NODE_ENV=production
export ENABLE_PURGECSS=true
export CDN_BASE_URL="${CDN_BASE_URL:-https://d1234567890.cloudfront.net}"

echo "Environment:"
echo "  NODE_ENV=$NODE_ENV"
echo "  ENABLE_PURGECSS=$ENABLE_PURGECSS"
echo "  CDN_BASE_URL=$CDN_BASE_URL"
echo ""

# Run the build script
node build-with-purgecss.js

echo ""

# Step 5: Show Results
echo "Step 5: Build Results"
echo "----------------------------------------"

for file in "${CSS_FILES[@]}"; do
    if [ -f "$file" ]; then
        SIZE=$(du -h "$file" | cut -f1)
        echo "✓ Minified: $file ($SIZE)"
    fi
done

echo ""

# Step 6: Build Report
if [ -f "build-report.json" ]; then
    echo "Step 6: Build Report"
    echo "----------------------------------------"
    cat build-report.json
    echo ""
fi

# Step 7: Next Steps
echo "=========================================================================="
echo "Next Steps for AWS CodePipeline Deployment"
echo "=========================================================================="
echo ""
echo "1. Upload to S3:"
echo "   aws s3 sync ./assets s3://\$S3_BUCKET/assets --delete \\"
echo "     --cache-control 'public, max-age=31536000, immutable'"
echo ""
echo "2. Invalidate CloudFront Cache:"
echo "   aws cloudfront create-invalidation \\"
echo "     --distribution-id \$CLOUDFRONT_DIST_ID \\"
echo "     --paths '/*'"
echo ""
echo "3. Verify Deployment:"
echo "   curl -I https://\$CDN_BASE_URL/assets/css/site.css"
echo "   # Check Content-Length header for minified size"
echo ""
echo "=========================================================================="
echo "CSS Minification Complete!"
echo "=========================================================================="
echo ""
echo "Benefits:"
echo "  ✓ Reduced file size (40-60% smaller)"
echo "  ✓ Lower CloudFront bandwidth costs"
echo "  ✓ Faster page load times"
echo "  ✓ Improved Core Web Vitals scores"
echo ""
echo "For more information, see CSS-MINIFICATION-README.md"
echo ""
