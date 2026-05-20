import { RequireAuth } from '../../src/components/RequireAuth';
import { SearchParamsProvider } from '../../src/router/react-router-dom';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <RequireAuth><SearchParamsProvider>{children}</SearchParamsProvider></RequireAuth>;
}
