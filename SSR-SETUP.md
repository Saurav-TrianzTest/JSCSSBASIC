# AWS Lambda SSR with Emotion Style Extraction

This project is configured for server-side rendering (SSR) on AWS Lambda with proper Emotion CSS-in-JS style extraction to prevent Flash of Unstyled Content (FOUC).

## Architecture

### Server-Side Rendering (SSR)
- **Location**: `src/server/ssr-handler.js`
- **Purpose**: AWS Lambda handler that renders React components server-side and extracts critical CSS
- **Key Features**:
  - Emotion cache creation for SSR
  - Critical CSS extraction using `@emotion/server`
  - Style injection into HTML before sending to client
  - Prevents FOUC during hydration

### Client-Side Hydration
- **Location**: `src/client/hydration.js`
- **Purpose**: Hydrates server-rendered HTML on the client
- **Key Features**:
  - Matches server-side Emotion cache configuration
  - Cleans up duplicate server styles after hydration
  - Ensures smooth transition from SSR to client-side rendering

### Styled Components
- **Location**: `src/ui/styles.js`
- **Purpose**: Emotion styled-components with SSR support
- **Configuration**: References SSR handler for proper style extraction

## AWS Lambda Deployment

### Lambda Function Configuration

```javascript
// lambda-config.json
{
  "FunctionName": "analytics-portal-ssr",
  "Runtime": "nodejs18.x",
  "Handler": "src/server/ssr-handler.handler",
  "MemorySize": 512,
  "Timeout": 10,
  "Environment": {
    "Variables": {
      "NODE_ENV": "production"
    }
  }
}
```

### API Gateway Integration

The Lambda function should be integrated with API Gateway to handle HTTP requests:

```yaml
# API Gateway configuration
Resources:
  SSRFunction:
    Type: AWS::Lambda::Function
    Properties:
      FunctionName: analytics-portal-ssr
      Handler: src/server/ssr-handler.handler
      Runtime: nodejs18.x
      
  SSRApi:
    Type: AWS::ApiGatewayV2::Api
    Properties:
      Name: analytics-portal-api
      ProtocolType: HTTP
      
  SSRIntegration:
    Type: AWS::ApiGatewayV2::Integration
    Properties:
      ApiId: !Ref SSRApi
      IntegrationType: AWS_PROXY
      IntegrationUri: !GetAtt SSRFunction.Arn
```

## Dependencies

Required npm packages for SSR with Emotion:

```json
{
  "@emotion/styled": "^11.11.0",
  "@emotion/react": "^11.11.0",
  "@emotion/server": "^11.11.0",
  "@emotion/cache": "^11.11.0",
  "react": "^18.2.0",
  "react-dom": "^18.2.0"
}
```

## Usage

### Server-Side (AWS Lambda)

```javascript
import { handler } from './src/server/ssr-handler.js';

// Lambda will automatically invoke the handler
export { handler };
```

### Client-Side

```javascript
import { hydrateApp } from './src/client/hydration.js';
import App from './App.js';

// Hydrate the server-rendered content
hydrateApp(<App />);
```

## How It Works

1. **Request arrives at AWS Lambda** via API Gateway
2. **SSR Handler** creates an Emotion cache and renders React components
3. **Critical CSS is extracted** using `@emotion/server`
4. **Styles are injected** into the HTML `<head>` before sending response
5. **Client receives** fully-styled HTML (no FOUC)
6. **Client hydrates** the React app using matching Emotion cache
7. **Server styles are cleaned up** after client takes over

## Benefits

- ✅ **No FOUC**: Styles are present on initial render
- ✅ **Fast First Paint**: Critical CSS is inlined
- ✅ **SEO Friendly**: Fully rendered HTML for crawlers
- ✅ **Cloud Native**: Optimized for AWS Lambda serverless architecture
- ✅ **Scalable**: Lambda auto-scales based on traffic

## Testing SSR Locally

```bash
# Install dependencies
npm install

# Test SSR handler locally
node -e "import('./src/server/ssr-handler.js').then(m => m.handler({}, {}).then(console.log))"
```

## Monitoring

Monitor Lambda function performance:
- Cold start times
- Memory usage
- Execution duration
- Error rates

Use AWS CloudWatch for logging and metrics.

## Troubleshooting

### Styles not appearing
- Verify `@emotion/server` is installed
- Check that cache key matches between server and client ('css')
- Ensure styles are being extracted in Lambda logs

### Hydration mismatches
- Verify server and client render the same component tree
- Check that data fetching is consistent
- Ensure environment variables are properly set

### Lambda timeouts
- Increase Lambda timeout setting
- Optimize component rendering
- Consider caching strategies

## Additional Resources

- [Emotion SSR Documentation](https://emotion.sh/docs/ssr)
- [AWS Lambda Node.js Runtime](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html)
- [React Server-Side Rendering](https://react.dev/reference/react-dom/server)
