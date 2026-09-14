/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ['@bouquet/core', '@bouquet/db', '@bouquet/shared'],
  experimental: { serverActions: { bodySizeLimit: '1mb' } },
};
