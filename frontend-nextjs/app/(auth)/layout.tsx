import { AuthLanguageSwitcher } from '../../src/components/AuthLanguageSwitcher';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      <AuthLanguageSwitcher />
      {children}
    </div>
  );
}
