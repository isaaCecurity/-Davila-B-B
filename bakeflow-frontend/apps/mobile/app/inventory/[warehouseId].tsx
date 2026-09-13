import { useLocalSearchParams } from 'expo-router';

import { StockScreen } from '../../features/inventory/components/StockScreen';

/** Deep link to one stockroom's stock; the same screen with that stockroom chosen. */
export default function WarehouseStockRoute(): React.JSX.Element {
  const { warehouseId } = useLocalSearchParams<{ warehouseId: string }>();
  return <StockScreen warehouseId={typeof warehouseId === 'string' && warehouseId !== '' ? warehouseId : undefined} />;
}
