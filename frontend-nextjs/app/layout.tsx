import type { Metadata } from 'next';
import '../src/index.css';
import { AppProviders } from '../src/components/AppProviders';

export const metadata: Metadata = {
  title: 'Basjoo',
  description: 'Basjoo admin dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
