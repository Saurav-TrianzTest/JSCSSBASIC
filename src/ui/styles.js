import styled from '@emotion/styled';

// SSR style extraction configured for AWS Lambda
// Use @emotion/server's extractCritical or renderStylesToString on server-side
// See src/server/ssr-handler.js for AWS Lambda SSR implementation

export const Box = styled.div`
  padding: 16px;
`;

// Client-only CSS loaded after hydration
if (typeof window === 'object') {
  import('../css/deferred.css', { with: { type: 'css' } }).catch(function () {});
}
