import { CashScreen } from '../../features/finance/components/CashScreen';

/** Cash — the Branch Manager's till tab (prototype `cash`). */
export default function CashTab(): React.JSX.Element {
  return <CashScreen mine={false} />;
}
