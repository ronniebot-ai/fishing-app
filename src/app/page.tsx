import { parseSpot } from '../domain/spotUrl';
import App from './App';

/**
 * A shared `?lat=&lon=` link is resolved here, on the server, so the page
 * arrives already showing that spot rather than picking it up after hydration.
 *
 * This is also why `App` takes the spot as a prop instead of reading
 * `window.location` itself: the server has no window, and a component that
 * reads one during its first render cannot be server-rendered at all.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <App initialSpot={parseSpot(params.lat, params.lon)} />;
}
