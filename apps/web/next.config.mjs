/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ['@bouquet/core', '@bouquet/db', '@bouquet/shared'],
  experimental: { serverActions: { bodySizeLimit: '1mb' } },
  webpack: (config) => {
    // Workspace packages use ESM-correct './x.js' specifiers that resolve to
    // './x.ts' on disk. tsx and vitest handle this; webpack needs telling.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};
