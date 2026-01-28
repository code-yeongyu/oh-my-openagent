import { defineConfig } from '@rslib/core';

export default defineConfig({
  lib: [
    // Main plugin entry
    {
      format: 'esm',
      bundle: true,
      dts: {
        bundle: true,
      },
      output: {
        distPath: './dist',
      },
      source: {
        entry: {
          index: './src/index.ts',
        },
      },
    },
    // CLI entry
    {
      format: 'esm',
      dts: {
        bundle: false,
      },
      output: {
        distPath: './dist/cli',
      },
      source: {
        entry: {
          index: './src/cli/index.ts',
        },
      },
    },
  ],
  output: {
    target: 'node', // Bun supports Node.js APIs
    cleanDistPath: true, // Clean dist directory before build
    externals: ['bun'], // Don't bundle 'bun' runtime imports
  },
});
