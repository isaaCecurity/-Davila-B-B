import { Redirect } from 'expo-router';

/**
 * The first driver screen (ADR-001 Phase 5) now lives at `/trip`, ported from the prototype.
 * Old links land there.
 */
export default function DriverHomeRedirect(): React.JSX.Element {
  return <Redirect href="/trip" />;
}
