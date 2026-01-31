import { describe, it, expect } from 'bun:test';
import { checkTestQuality } from './test-quality-gate';

describe('TestQualityGate', () => {
  //#given
  const dbCode = `
    it('should save to db', async () => {
      await db.collection('users').insertOne({ name: 'test' });
    });
  `;

  const networkCode = `
    it('should fetch data', async () => {
      const res = await fetch('https://api.example.com');
    });
  `;

  const cleanCode = `
    it('should add numbers', () => {
      expect(1 + 1).toBe(2);
    });
  `;

  it('should detect database operations in tests', () => {
    //#when
    const result = checkTestQuality(dbCode, 'src/shared/db.test.ts');
    
    //#then
    expect(result.warnings).toContain('Direct database operation detected');
  });

  it('should detect network requests in tests', () => {
    //#when
    const result = checkTestQuality(networkCode, 'src/shared/network.test.ts');
    
    //#then
    expect(result.warnings).toContain('Direct network request detected');
  });

  it('should warn but not block on detection', () => {
    //#when
    const result = checkTestQuality(dbCode, 'src/shared/db.test.ts');
    
    //#then
    expect(result.passed).toBe(true); // Should not block
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('should respect whitelist configuration', () => {
    //#given
    const config = {
      whitelist: ['**/integration-tests/**']
    };
    
    //#when
    const result = checkTestQuality(dbCode, 'src/integration-tests/db.test.ts', config);
    
    //#then
    expect(result.warnings).toHaveLength(0);
  });
});
