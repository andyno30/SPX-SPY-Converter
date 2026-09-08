import {fileURLToPath} from 'node:url';

/** @type {import('next').NextConfig} */
export default {
  basePath: '/game',
  poweredByHeader: false,
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  outputFileTracingExcludes: {
    '/*': ['./research/**/*', './docs/**/*', './content/**/*', './tests/**/*', './supabase/**/*'],
  },
  async headers() {
    return [{source: '/:path*', headers: [
      {key: 'X-Content-Type-Options', value: 'nosniff'},
      {key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin'},
      {key: 'X-Robots-Tag', value: 'noindex, nofollow'},
    ]}];
  },
};
