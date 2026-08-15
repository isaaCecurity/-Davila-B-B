// @bakeflow/types — shared domain types.
//
// Per docs/FRONTEND-STRUCTURE.md this package is nominally "generated from live DB
// schema (`supabase gen types`)". The catalog types are hand-written instead, for two
// verified reasons documented in ./scalars.ts and ./catalog.ts: the generator types
// money and quantity columns as `number` (IEEE-754 doubles, forbidden by AD-010 and
// CLAUDE.md rule 5), and it widens CHECK-constrained text columns to `string`.
//
// The generator output was still consulted as a cross-check — the non-numeric column
// sets below match it exactly.

export type { Money, Quantity, Timestamptz, Uuid } from './scalars';
export {
  MONEY_PATTERN,
  QUANTITY_PATTERN,
  compareDecimalStrings,
  isNegativeDecimalString,
  isZeroDecimalString,
} from './scalars';

// `unsafeMoney` / `unsafeQuantity` are deliberately NOT re-exported here.
//
// They brand a string as money without validating it, which is the one operation that
// can defeat the entire precision strategy. Their doc comment says "the only supported
// caller is packages/validation" — but a comment is not a boundary, and while they sat
// in this barrel any screen could `import { unsafeMoney } from '@bakeflow/types'` and
// mint a Money from arbitrary input.
//
// They remain importable from '@bakeflow/types/scalars', which the tsconfig `paths`
// already maps. That is deep enough to be a deliberate act rather than an autocomplete
// accident, and it makes the intended boundary mechanical.

export type {
  Ingredient,
  IngredientRow,
  Product,
  ProductCategory,
  ProductCategoryRow,
  ProductRow,
  ProductVariant,
  ProductVariantRow,
  ProductWithVariants,
  Recipe,
  RecipeBillOfMaterials,
  RecipeIngredient,
  RecipeIngredientDetail,
  RecipeIngredientRow,
  RecipeRow,
  UnitOfMeasure,
} from './catalog';
export { UNITS_OF_MEASURE } from './catalog';

export type {
  IngredientStockLevel,
  IngredientStockLevelRow,
  IngredientStockMovement,
  ProductStockLevel,
  ProductStockLevelRow,
  ProductStockMovement,
  StockItemType,
  StockMovement,
  StockMovementReason,
  StockMovementRow,
  StockReferenceType,
  Warehouse,
  WarehouseRow,
} from './inventory';
export {
  NEGATIVE_STOCK_REASONS,
  POSITIVE_STOCK_REASONS,
  STOCK_ITEM_TYPES,
  STOCK_MOVEMENT_REASONS,
  STOCK_REFERENCE_TYPES,
} from './inventory';

export type {
  ProductionBatch,
  ProductionBatchIngredient,
  ProductionBatchStatus,
  ProductionBatchWithIngredients,
} from './production';
export {
  PRODUCTION_BATCH_STATUSES,
  TERMINAL_PRODUCTION_BATCH_STATUSES,
  isTerminalProductionBatchStatus,
} from './production';

export type {
  Customer,
  SaleCustomerType,
  Ticket,
  TicketFulfilmentType,
  TicketItem,
  TicketStatus,
  TicketWithItems,
} from './sales';
export {
  SALE_CUSTOMER_TYPES,
  TERMINAL_TICKET_STATUSES,
  TICKET_FULFILMENT_TYPES,
  TICKET_ITEMS_LOCKED_STATUSES,
  TICKET_STATUSES,
  areTicketItemsLocked,
  isTerminalTicketStatus,
} from './sales';

export type { Delivery, DeliveryStatus } from './delivery';
export {
  DELIVERY_STATUSES,
  TERMINAL_DELIVERY_STATUSES,
  isDeliveryVerified,
  isTerminalDeliveryStatus,
} from './delivery';

export type { OrganizationMembership, OrganizationRole } from './organization';
