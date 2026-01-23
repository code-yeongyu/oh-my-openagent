import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'ko', 'zh', 'ja'],
  defaultLocale: 'en'
});
