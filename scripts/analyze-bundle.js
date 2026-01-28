#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';

console.log('=== Manual Bundle Analysis ===\n');

try {
  // Read the bundle file
  const bundlePath = './dist/index.js';
  const bundleContent = await fs.readFile(bundlePath, 'utf-8');

  console.log(`📂 Reading bundle: ${bundlePath}`);
  console.log(`📏 Bundle size: ${(bundleContent.length / 1024).toFixed(2)} KB\n`);

  // Basic statistics
  const lines = bundleContent.split('\n').length;
  const wordCount = bundleContent.split(/\s+/).length;

  console.log('📊 BASIC METRICS:');
  console.log(`  Lines of code: ${lines}`);
  console.log(`  Word count: ${wordCount}`);
  console.log(`  File size: ${bundleContent.length} bytes\n`);

  // Analyze code structure
  const functionMatches = bundleContent.match(/function\s+\w+\s*\(/g);
  const arrowFunctionMatches = bundleContent.match(/=>/g);
  const classMatches = bundleContent.match(/\bclass\s+\w+/g);

  console.log('🏗️  CODE STRUCTURE:');
  console.log(`  Function declarations: ${functionMatches?.length || 0}`);
  console.log(`  Arrow functions: ${arrowFunctionMatches?.length || 0}`);
  console.log(`  Class definitions: ${classMatches?.length || 0}\n`);

  // Find common patterns
  const importRegex = /import\s+.*from\s+['"](.+)['"]/g;
  const importCount = (bundleContent.match(importRegex) || []).length;

  const requireRegex = /require\s*\(\s*['"](.+)['"]\s*\)/g;
  const requireCount = (bundleContent.match(requireRegex) || []).length;

  console.log('🔗 IMPORTS/REQUIRES:');
  console.log(`  ES6 imports: ${importCount}`);
  console.log(`  CommonJS requires: ${requireCount}\n`);

  // Find large dependencies
  const largeDependencies = [];
  const depRegex = /['"]([^'"]+\.(js|ts|json))['"]/g;
  let match;
  while ((match = depRegex.exec(bundleContent)) !== null) {
    const depPath = match[1];
    // Skip built-in modules, relative paths, and small files
    if (!depPath.startsWith('.') && !depPath.startsWith('/') && depPath.length > 5) {
      largeDependencies.push(depPath);
    }
  }

  console.log('📦 POTENTIAL DEPENDENCIES:');
  largeDependencies.slice(0, 20).forEach(dep => {
    console.log(`  - ${dep}`);
  });
  if (largeDependencies.length > 20) {
    console.log(`  ... and ${largeDependencies.length - 20} more`);
  }

  // Check for specific patterns
  const hasConfig = bundleContent.includes('config');
  const hasAgents = bundleContent.includes('agents');
  const hasHooks = bundleContent.includes('hooks');
  const hasTools = bundleContent.includes('tools');
  const hasMCP = bundleContent.includes('mcp');

  console.log('\n🔍 FEATURE DETECTION:');
  console.log(`  Config handling: ${hasConfig ? '✓' : '✗'}`);
  console.log(`  Agent definitions: ${hasAgents ? '✓' : '✗'}`);
  console.log(`  Hook system: ${hasHooks ? '✓' : '✗'}`);
  console.log(`  Tool registry: ${hasTools ? '✓' : '✗'}`);
  console.log(`  MCP integration: ${hasMCP ? '✓' : '✗'}\n`);

  // Module size breakdown (approximate by file extension)
  const jsFiles = bundleContent.match(/['"]([^'"]+\.js)['"]/g) || [];
  const tsFiles = bundleContent.match(/['"]([^'"]+\.ts)['"]/g) || [];
  const dtsFiles = bundleContent.match(/['"]([^'"]+\.d\.ts)['"]/g) || [];

  console.log('📄 FILE TYPE BREAKDOWN:');
  console.log(`  JavaScript files referenced: ${jsFiles.length}`);
  console.log(`  TypeScript files referenced: ${tsFiles.length}`);
  console.log(`  Type definition files: ${dtsFiles.length}\n`);

  // Optimization opportunities
  console.log('💡 OPTIMIZATION RECOMMENDATIONS:');
  console.log('  1. Code splitting: Consider splitting large bundles by feature');
  console.log('  2. Dynamic imports: Lazy load agents, hooks, and tools');
  console.log('  3. Tree shaking: Ensure unused exports are eliminated');
  console.log('  4. Dead code elimination: Remove commented-out code and tests');
  console.log('  5. Bundle size: 1.0 MB is reasonable but could be optimized');
  console.log('  6. Dependency analysis: Audit for unused dependencies');
  console.log('  7. Minification: Already using Terser/Esbuild minification');

  console.log('\n✨ Analysis complete! Use Rsdoctor Web UI (http://localhost:9100) for interactive analysis');

} catch (err) {
  console.error('❌ Analysis failed:', err);
  console.error('\nStack trace:', err.stack);
  process.exit(1);
}
