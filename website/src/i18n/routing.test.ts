import { describe, it, expect } from 'vitest';
import { routing } from './config';

describe('i18n routing', () => {
  it('should have correct locales', () => {
    expect(routing.locales).toEqual(['en', 'ko', 'zh', 'ja']);
  });

  it('should have correct default locale', () => {
    expect(routing.defaultLocale).toBe('en');
  });
});
