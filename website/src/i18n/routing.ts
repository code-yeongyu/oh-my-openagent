import { createNavigation } from 'next-intl/navigation';
import { routing } from './config';

export { routing };

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
