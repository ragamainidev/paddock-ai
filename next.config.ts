import type { NextConfig } from 'next';
import { withEve } from 'eve/next';

const nextConfig: NextConfig = {
  // /evals reads the committed eval artifact from disk at request time;
  // make sure it lands in the serverless bundle.
  outputFileTracingIncludes: {
    '/evals': ['./evals/results.json'],
  },
  images: {
    // eBay listing thumbnails.
    remotePatterns: [
      { protocol: 'https', hostname: 'i.ebayimg.com' },
      { protocol: 'https', hostname: '*.ebaystatic.com' },
    ],
  },
};

// The assessment agent in ./agent (withEve's default root) is co-hosted with
// this app: /eve/v1/** rewrites to the eve service in `next dev`, in a local
// production start and in one Vercel project. Only that prefix is rewritten,
// so the agent has no ingress other than eve's own session routes.
export default withEve(nextConfig);
