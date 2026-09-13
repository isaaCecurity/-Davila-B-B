import { useActivePersona } from '../../features/auth/hooks/useActivePersona';
import { AdminHome, BakerHome, CashierHome, DriverHome } from '../../features/home/CrewHomes';
import { ManagerHome } from '../../features/home/ManagerHome';
import { OwnerHome } from '../../features/home/OwnerHome';
import { SupervisorHome } from '../../features/home/SupervisorHome';
import { NoOrganizationState } from '../../components/ScreenState';
import { useSessionStore } from '../../stores/session';
import { useRouter } from 'expo-router';

/**
 * Home — the prototype's role-adaptive `home`. The information architecture changes by role, not
 * just what is visible: an owner reads money, a manager the queue, a baker the kitchen, a driver
 * the trip. The persona is advisory (see `navigation/tabs.ts`); RLS decides what each home can
 * actually load.
 */
export default function HomeScreen(): React.JSX.Element {
  const router = useRouter();
  const persona = useActivePersona();
  const tenantId = useSessionStore((s) => s.activeTenantId);

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  switch (persona) {
    case 'owner':
      return <OwnerHome />;
    case 'manager':
      return <ManagerHome />;
    case 'supervisor':
      return <SupervisorHome />;
    case 'cashier':
      return <CashierHome />;
    case 'baker':
      return <BakerHome />;
    case 'driver':
      return <DriverHome />;
    case 'admin':
      return <AdminHome />;
  }
}
