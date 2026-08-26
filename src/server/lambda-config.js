/**
 * AWS Lambda Configuration for SSR Deployment
 * 
 * This file provides configuration templates for deploying the
 * Emotion SSR application to AWS Lambda with API Gateway.
 */

export const lambdaConfig = {
  // Lambda Function Configuration
  function: {
    name: 'analytics-portal-ssr',
    runtime: 'nodejs18.x',
    handler: 'src/server/ssr-handler.handler',
    memorySize: 512, // MB - adjust based on your app's needs
    timeout: 10, // seconds - SSR should be fast
    environment: {
      NODE_ENV: 'production',
      // Add other environment variables as needed
      // API_ENDPOINT: process.env.API_ENDPOINT,
      // DATABASE_URL: process.env.DATABASE_URL,
    }
  },

  // API Gateway Configuration
  apiGateway: {
    name: 'analytics-portal-api',
    protocol: 'HTTP',
    cors: {
      allowOrigins: ['*'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization']
    }
  },

  // CloudWatch Logs Configuration
  logging: {
    retentionDays: 7,
    logLevel: 'INFO'
  },

  // Performance Optimization
  optimization: {
    // Enable Lambda SnapStart for faster cold starts (Java only, but good to know)
    // For Node.js, consider provisioned concurrency for critical paths
    provisionedConcurrency: 0, // Set > 0 for production if needed
    
    // Reserved concurrent executions (optional)
    reservedConcurrency: null, // null = unreserved
    
    // Lambda layers for shared dependencies
    layers: [
      // Add ARNs for Lambda layers if using shared dependencies
      // 'arn:aws:lambda:us-east-1:123456789012:layer:emotion-deps:1'
    ]
  },

  // VPC Configuration (if accessing private resources)
  vpc: {
    enabled: false,
    // Uncomment and configure if Lambda needs VPC access
    // subnetIds: ['subnet-12345', 'subnet-67890'],
    // securityGroupIds: ['sg-12345']
  },

  // IAM Role Permissions
  iamRole: {
    // Minimum required permissions
    policies: [
      'AWSLambdaBasicExecutionRole', // CloudWatch Logs
      // Add additional policies as needed:
      // 'AmazonS3ReadOnlyAccess', // If reading from S3
      // 'AmazonDynamoDBReadOnlyAccess', // If reading from DynamoDB
    ]
  }
};

/**
 * Serverless Framework Configuration (serverless.yml equivalent)
 */
export const serverlessConfig = {
  service: 'analytics-portal-ssr',
  provider: {
    name: 'aws',
    runtime: 'nodejs18.x',
    region: 'us-east-1', // Change to your preferred region
    stage: '${opt:stage, "dev"}',
    memorySize: 512,
    timeout: 10,
    environment: {
      NODE_ENV: '${self:provider.stage}'
    }
  },
  functions: {
    ssr: {
      handler: 'src/server/ssr-handler.handler',
      events: [
        {
          httpApi: {
            path: '/',
            method: 'GET'
          }
        },
        {
          httpApi: {
            path: '/{proxy+}',
            method: 'GET'
          }
        }
      ]
    }
  },
  package: {
    exclude: [
      'node_modules/**',
      '!node_modules/@emotion/**',
      '!node_modules/react/**',
      '!node_modules/react-dom/**'
    ]
  }
};

/**
 * AWS SAM Template Configuration (template.yaml equivalent)
 */
export const samTemplate = {
  AWSTemplateFormatVersion: '2010-09-09',
  Transform: 'AWS::Serverless-2016-10-31',
  Description: 'Analytics Portal SSR with Emotion',
  
  Globals: {
    Function: {
      Timeout: 10,
      MemorySize: 512,
      Runtime: 'nodejs18.x',
      Environment: {
        Variables: {
          NODE_ENV: 'production'
        }
      }
    }
  },
  
  Resources: {
    SSRFunction: {
      Type: 'AWS::Serverless::Function',
      Properties: {
        CodeUri: './',
        Handler: 'src/server/ssr-handler.handler',
        Events: {
          RootPath: {
            Type: 'HttpApi',
            Properties: {
              Path: '/',
              Method: 'GET'
            }
          },
          ProxyPath: {
            Type: 'HttpApi',
            Properties: {
              Path: '/{proxy+}',
              Method: 'GET'
            }
          }
        }
      }
    }
  },
  
  Outputs: {
    SSRApi: {
      Description: 'API Gateway endpoint URL',
      Value: {
        'Fn::Sub': 'https://${ServerlessHttpApi}.execute-api.${AWS::Region}.amazonaws.com/'
      }
    },
    SSRFunction: {
      Description: 'SSR Lambda Function ARN',
      Value: {
        'Fn::GetAtt': ['SSRFunction', 'Arn']
      }
    }
  }
};

/**
 * Environment-specific configurations
 */
export const environments = {
  development: {
    memorySize: 256,
    timeout: 30,
    logLevel: 'DEBUG',
    provisionedConcurrency: 0
  },
  staging: {
    memorySize: 512,
    timeout: 10,
    logLevel: 'INFO',
    provisionedConcurrency: 1
  },
  production: {
    memorySize: 1024,
    timeout: 10,
    logLevel: 'WARN',
    provisionedConcurrency: 5
  }
};
