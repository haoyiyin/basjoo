import { RequireAuth } from '../../src/components/RequireAuth';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>;
}
