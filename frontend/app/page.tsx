import CommuteMapViewLoader from "../components/CommuteMapViewLoader";
import { getApiBaseCandidates, toApiUrl } from "../lib/api";

type RouteStop = {
  id: number;
  name: string;
  latitude: string;
  longitude: string;
  order_index: number;
  is_stop?: boolean;
};

type CommuteRoute = {
  id: number;
  name: string;
  route_code: string | null;
  start_point: string;
  end_point: string;
  base_fare: string;
  description: string | null;
  route_description: string | null;
  schedule: string | null;
  service_period: string | null;
  route_color: string | null;
  polyline_color: string | null;
  stops: RouteStop[];
};

async function getRoutes(): Promise<CommuteRoute[]> {
  const apiBases = getApiBaseCandidates();

  for (const apiBase of apiBases) {
    try {
      const res = await fetch(toApiUrl(apiBase, "/api/routes"), {
        cache: "no-store",
      });

      if (!res.ok) {
        continue;
      }

      return (await res.json()) as CommuteRoute[];
    } catch {
      continue;
    }
  }

  return [];
}

export default async function Home() {
  const routes = await getRoutes();

  return <CommuteMapViewLoader routes={routes} />;
}
