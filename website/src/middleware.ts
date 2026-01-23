import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/config';

export default createMiddleware(routing);

export const config = {
  matcher: ['/', '/(ko|en|zh|ja)/:path*']
};
