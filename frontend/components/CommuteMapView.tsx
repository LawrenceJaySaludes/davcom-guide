"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Image from "next/image";
import {
  MapContainer,
  Marker,
  Popup,
  Polyline,
  TileLayer,
  ZoomControl,
  useMap,
} from "react-leaflet";
import L from "leaflet";

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

type PlaceSuggestion = {
  name: string;
  label: string;
  type: string;
  latitude: number;
  longitude: number;
};

type RouteMatch = {
  route: CommuteRoute;
  distanceMeters: number;
};

type NearbyStop = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  order_index: number;
  distance_meters: number;
};

type NearbyRoute = {
  route_id: number;
  route_name: string;
  route_code: string;
  service_period: string | null;
  route_color: string | null;
  polyline_color: string | null;
  start_point: string;
  end_point: string;
  description: string | null;
  route_description: string | null;
  schedule: string | null;
  nearest_stop: NearbyStop;
  distance_meters: number;
  nearby_stop_count: number;
  nearby_stops: NearbyStop[];
};

type Props = {
  routes: CommuteRoute[];
};

const DESTINATION_MATCH_RADIUS_METERS = 650;
const DESTINATION_SEARCH_MIN_CHARS = 2;
const DESTINATION_SEARCH_DEBOUNCE_MS = 40;
const DEFAULT_NEARBY_RADIUS_METERS = 500;
const DEFAULT_ROUTE_COLOR = "#db2777";
const BUS_ROUTE_COLOR = "#35b0ab";
const BUS_SERVICE_PERIOD_ORDER: Record<string, number> = {
  AM: 0,
  PM: 1,
};

type BusRouteGroup = {
  route_code: string;
  display_name: string;
  routes: CommuteRoute[];
};

function normalizeRouteCode(routeCode: string | null | undefined, fallbackName: string) {
  const value = typeof routeCode === "string" ? routeCode.trim() : "";

  if (value !== "") {
    return value;
  }

  const fallbackValue = fallbackName.trim();
  return fallbackValue !== "" ? fallbackValue : "Unspecified Route";
}

function getRouteCode(route: Pick<CommuteRoute, "route_code" | "name"> | Pick<NearbyRoute, "route_code" | "route_name">) {
  if ("name" in route) {
    return normalizeRouteCode(route.route_code, route.name);
  }

  return normalizeRouteCode(route.route_code, route.route_name);
}

function getRouteServicePeriod(
  route: Pick<CommuteRoute, "service_period"> | Pick<NearbyRoute, "service_period"> | null | undefined
) {
  const servicePeriod = typeof route?.service_period === "string" ? route.service_period.trim() : "";
  return servicePeriod.toUpperCase();
}

function compareRouteServicePeriod(a: string, b: string) {
  const orderA = BUS_SERVICE_PERIOD_ORDER[a] ?? 99;
  const orderB = BUS_SERVICE_PERIOD_ORDER[b] ?? 99;

  if (orderA !== orderB) {
    return orderA - orderB;
  }

  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function groupBusRoutes(routes: CommuteRoute[]) {
  const grouped = new Map<string, BusRouteGroup>();

  for (const route of routes) {
    const routeCode = getRouteCode(route);
    const existing = grouped.get(routeCode);

    if (!existing) {
      grouped.set(routeCode, {
        route_code: routeCode,
        display_name: routeCode,
        routes: [route],
      });
      continue;
    }

    existing.routes.push(route);
  }

  return [...grouped.values()]
    .map((group) => ({
      ...group,
      routes: [...group.routes].sort((a, b) =>
        compareRouteServicePeriod(getRouteServicePeriod(a), getRouteServicePeriod(b))
      ),
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, undefined, { sensitivity: "base" }));
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function haversineDistanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number
) {
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(latitudeB - latitudeA);
  const dLng = toRadians(longitudeB - longitudeA);
  const latARadians = toRadians(latitudeA);
  const latBRadians = toRadians(latitudeB);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(latARadians) *
      Math.cos(latBRadians) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusMeters * c;
}

function toLocalMeters(latitude: number, longitude: number, referenceLatitude: number) {
  const earthRadiusMeters = 6371000;
  const referenceLatitudeRadians = toRadians(referenceLatitude);

  return {
    x: toRadians(longitude) * Math.cos(referenceLatitudeRadians) * earthRadiusMeters,
    y: toRadians(latitude) * earthRadiusMeters,
  };
}

function distancePointToSegmentMeters(
  point: PlaceSuggestion,
  segmentStart: [number, number],
  segmentEnd: [number, number]
) {
  const referenceLatitude = point.latitude;
  const pointMeters = toLocalMeters(point.latitude, point.longitude, referenceLatitude);
  const startMeters = toLocalMeters(segmentStart[0], segmentStart[1], referenceLatitude);
  const endMeters = toLocalMeters(segmentEnd[0], segmentEnd[1], referenceLatitude);

  const segmentX = endMeters.x - startMeters.x;
  const segmentY = endMeters.y - startMeters.y;
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (segmentLengthSquared === 0) {
    const deltaX = pointMeters.x - startMeters.x;
    const deltaY = pointMeters.y - startMeters.y;
    return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  }

  const projection = Math.max(
    0,
    Math.min(
      1,
      ((pointMeters.x - startMeters.x) * segmentX +
        (pointMeters.y - startMeters.y) * segmentY) /
        segmentLengthSquared
    )
  );

  const projectedX = startMeters.x + projection * segmentX;
  const projectedY = startMeters.y + projection * segmentY;
  const deltaX = pointMeters.x - projectedX;
  const deltaY = pointMeters.y - projectedY;

  return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
}

function routeDistanceMeters(route: CommuteRoute, destination: PlaceSuggestion) {
  const coordinates = route.stops
    .map((stop) => [Number(stop.latitude), Number(stop.longitude)] as [number, number])
    .filter(([latitude, longitude]) => Number.isFinite(latitude) && Number.isFinite(longitude));

  if (coordinates.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  if (coordinates.length === 1) {
    return haversineDistanceMeters(
      destination.latitude,
      destination.longitude,
      coordinates[0][0],
      coordinates[0][1]
    );
  }

  let shortestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const distance = distancePointToSegmentMeters(
      destination,
      coordinates[index],
      coordinates[index + 1]
    );

    if (distance < shortestDistance) {
      shortestDistance = distance;
    }
  }

  return shortestDistance;
}

function routeNearestStopDistanceMeters(
  route: CommuteRoute,
  destination: PlaceSuggestion
) {
  const coordinates = route.stops
    .map((stop) => [Number(stop.latitude), Number(stop.longitude)] as [number, number])
    .filter(([latitude, longitude]) => Number.isFinite(latitude) && Number.isFinite(longitude));

  if (coordinates.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  let shortestDistance = Number.POSITIVE_INFINITY;

  for (const [latitude, longitude] of coordinates) {
    const distance = haversineDistanceMeters(
      destination.latitude,
      destination.longitude,
      latitude,
      longitude
    );

    if (distance < shortestDistance) {
      shortestDistance = distance;
    }
  }

  return shortestDistance;
}

function routeMatchDistanceMeters(route: CommuteRoute, destination: PlaceSuggestion) {
  return Math.min(
    routeDistanceMeters(route, destination),
    routeNearestStopDistanceMeters(route, destination)
  );
}

function getCachedDestinationPreview(
  query: string,
  cache: Map<string, PlaceSuggestion[]>
) {
  let bestMatch: PlaceSuggestion[] = [];
  let bestLength = -1;

  for (const [cachedQuery, suggestions] of cache.entries()) {
    if (!query.startsWith(cachedQuery)) {
      continue;
    }

    if (cachedQuery.length > bestLength) {
      bestMatch = suggestions;
      bestLength = cachedQuery.length;
    }
  }

  return bestMatch;
}

const userIcon = L.divIcon({
  className: "user-location-marker",
  html: '<span class="user-location-pulse"></span><span class="user-location-dot"></span>',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

function getRouteColor(routeColor: string | null | undefined) {
  return typeof routeColor === "string" && routeColor.trim() !== ""
    ? routeColor
    : DEFAULT_ROUTE_COLOR;
}

function getRouteDescriptionText(
  route: Pick<CommuteRoute, "route_description" | "description"> | null | undefined
) {
  if (!route) {
    return "";
  }

  const primaryDescription =
    typeof route.route_description === "string" ? route.route_description.trim() : "";

  if (primaryDescription !== "") {
    return primaryDescription;
  }

  return typeof route.description === "string" ? route.description.trim() : "";
}

function getRouteScheduleText(route: Pick<CommuteRoute, "schedule"> | null | undefined) {
  const schedule = typeof route?.schedule === "string" ? route.schedule.trim() : "";

  return schedule !== "" ? schedule : "No schedule added yet.";
}

function normalizeRouteColor(routeColor: string | null | undefined) {
  if (typeof routeColor !== "string") {
    return "";
  }

  const normalizedColor = routeColor.trim().toLowerCase();

  if (normalizedColor === "") {
    return "";
  }

  return normalizedColor.startsWith("#") ? normalizedColor : `#${normalizedColor}`;
}

function isInterimBusRoute(
  route: Pick<CommuteRoute, "route_color" | "polyline_color"> | Pick<NearbyRoute, "route_color" | "polyline_color">
) {
  return normalizeRouteColor(route.polyline_color ?? route.route_color) === BUS_ROUTE_COLOR;
}

function getRoutePath(route: Pick<CommuteRoute, "stops">) {
  if (!route?.stops?.length) {
    return [];
  }

  return route.stops
    .map((stop) => [Number(stop.latitude), Number(stop.longitude)] as [number, number])
    .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
}

function createRouteStopIcon(color: string, label: string) {
  return L.divIcon({
    className: "route-stop-marker",
    html: `
      <div style="
        width: 28px;
        height: 28px;
        border-radius: 9999px;
        border: 3px solid rgba(255,255,255,0.96);
        background: ${color};
        box-shadow: 0 12px 24px -12px rgba(15, 23, 42, 0.45);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: 800;
        line-height: 1;
      ">${label}</div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function shouldShowStopMarker(stop: RouteStop) {
  return Boolean(stop.is_stop) || /^Stop\s+/i.test(stop.name);
}

function FlyToUserLocation({ position }: { position: [number, number] | null }) {
  const map = useMap();

  useEffect(() => {
    if (position) {
      map.flyTo(position, 16);
    }
  }, [map, position]);

  return null;
}

function FitToRoutePath({ positions }: { positions: [number, number][] }) {
  const map = useMap();

  useEffect(() => {
    if (positions.length < 2) {
      return;
    }

    const bounds = L.latLngBounds(positions);

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [map, positions]);

  return null;
}

function FlyToPosition({
  position,
  zoom = 16,
}: {
  position: [number, number] | null;
  zoom?: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (position) {
      map.flyTo(position, zoom);
    }
  }, [map, position, zoom]);

  return null;
}

function SearchSpinner({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-slate-400 border-r-transparent ${className}`}
      aria-hidden="true"
    />
  );
}

const getNearbySwal = async () => {
  const swalModule = await import("sweetalert2");
  return swalModule.default;
};

const nearbySwalCustomClass = {
  popup:
    "rounded-[1.75rem] border border-white/70 bg-white/95 shadow-[0_28px_80px_-32px_rgba(15,23,42,0.45)]",
  title: "text-slate-900 text-2xl font-black tracking-tight",
  htmlContainer: "text-sm leading-6 text-slate-600",
  confirmButton:
    "rounded-2xl bg-gradient-to-r from-pink-500 to-black px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:shadow-xl",
  cancelButton:
    "rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50",
  loader: "border-pink-500",
};

const nearbySwalIconColor = "#db2777";

function PlaneIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.7 2.3a1 1 0 0 0-1.06-.23L2.97 9.15a1 1 0 0 0 .05 1.87l7.34 2.55 2.55 7.34a1 1 0 0 0 1.87.05l7.09-17.67a1 1 0 0 0-.17-1.0zM12 12l-1.16-1.16 7.22-5.05L12 12z" />
    </svg>
  );
}

function PowerOffIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden="true">
      <path d="M12 2v8" />
      <path d="M7.5 4.8a8 8 0 1 0 9 0" />
    </svg>
  );
}

function SwapIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden="true">
      <path d="M7 7h10" />
      <path d="m13 3 4 4-4 4" />
      <path d="M17 17H7" />
      <path d="m11 21-4-4 4-4" />
    </svg>
  );
}

function ChevronToggleIcon({
  className = "h-4 w-4",
  expanded,
}: {
  className?: string;
  expanded: boolean;
}) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      {expanded ? <path d="m6 15 6-6 6 6" /> : <path d="m6 9 6 6 6-6" />}
    </svg>
  );
}

export default function CommuteMapView({ routes }: Props) {
  const [selectedRoute, setSelectedRoute] = useState<CommuteRoute | null>(
    routes[0] ?? null
  );
  const [hasSelectedRoute, setHasSelectedRoute] = useState(false);
  const [routeMode, setRouteMode] = useState<"jeepney" | "bus">("jeepney");
  const [selectedBusStop, setSelectedBusStop] = useState<[number, number] | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [locationError, setLocationError] = useState("");
  const [destinationSearch, setDestinationSearch] = useState("");
  const [destinationSuggestions, setDestinationSuggestions] = useState<PlaceSuggestion[]>(
    []
  );
  const [destinationSearchError, setDestinationSearchError] = useState("");
  const [isSearchingDestinations, setIsSearchingDestinations] = useState(false);
  const [selectedDestination, setSelectedDestination] = useState<PlaceSuggestion | null>(
    null
  );
  const [destinationDropdownOpen, setDestinationDropdownOpen] = useState(false);
  const [destinationResultsOpen, setDestinationResultsOpen] = useState(true);
  const [destinationActiveIndex, setDestinationActiveIndex] = useState(-1);
  const [nearbySidebarOpen, setNearbySidebarOpen] = useState(false);
  const [nearbyRoutes, setNearbyRoutes] = useState<NearbyRoute[]>([]);
  const [nearbyRoutesLoaded, setNearbyRoutesLoaded] = useState(false);
  const [isFetchingNearbyRoutes, setIsFetchingNearbyRoutes] = useState(false);
  const [nearbyRoutesError, setNearbyRoutesError] = useState("");
  const [nearbyRoutesMessage, setNearbyRoutesMessage] = useState(
    "Tap Find Nearby Jeepneys to use your location."
  );
  const destinationSearchRef = useRef<HTMLDivElement | null>(null);
  const destinationCacheRef = useRef(new Map<string, PlaceSuggestion[]>());
  const destinationRequestIdRef = useRef(0);
  const nearbyRequestIdRef = useRef(0);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        destinationSearchRef.current &&
        !destinationSearchRef.current.contains(event.target as Node)
      ) {
        setDestinationDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  useEffect(() => {
    const trimmedQuery = destinationSearch.trim();

    if (trimmedQuery.length < DESTINATION_SEARCH_MIN_CHARS) {
      return;
    }

    const normalizedQuery = trimmedQuery.toLowerCase();
    const cachedSuggestions = destinationCacheRef.current.get(normalizedQuery);

    if (cachedSuggestions) {
      setDestinationSuggestions(cachedSuggestions);
      setDestinationSearchError("");
      setDestinationActiveIndex(cachedSuggestions.length > 0 ? 0 : -1);
    } else {
      const previewSuggestions = getCachedDestinationPreview(
        normalizedQuery,
        destinationCacheRef.current
      );

      if (previewSuggestions.length > 0) {
        setDestinationSuggestions(previewSuggestions);
        setDestinationSearchError("");
        setDestinationActiveIndex(previewSuggestions.length > 0 ? 0 : -1);
      } else {
        setDestinationSuggestions([]);
        setDestinationActiveIndex(-1);
      }
    }

    const controller = new AbortController();
    const requestId = ++destinationRequestIdRef.current;

    const timeoutId = window.setTimeout(async () => {
      setIsSearchingDestinations(true);
      setDestinationSearchError("");

      try {
        const response = await fetch(
          `/api-proxy/places/search?query=${encodeURIComponent(trimmedQuery)}&limit=5`,
          {
            cache: "no-store",
            headers: {
              Accept: "application/json",
            },
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error("Unable to load live place suggestions.");
        }

        const data = (await response.json()) as {
          suggestions?: PlaceSuggestion[];
        };

        if (requestId !== destinationRequestIdRef.current) {
          return;
        }

        const nextSuggestions = Array.isArray(data.suggestions)
          ? data.suggestions.filter(
              (item): item is PlaceSuggestion =>
                Boolean(
                  item &&
                    typeof item.name === "string" &&
                    typeof item.label === "string" &&
                    typeof item.type === "string" &&
                    Number.isFinite(item.latitude) &&
                    Number.isFinite(item.longitude)
                )
            )
          : [];

        destinationCacheRef.current.set(normalizedQuery, nextSuggestions);
        setDestinationSuggestions(nextSuggestions);
        setDestinationActiveIndex(nextSuggestions.length > 0 ? 0 : -1);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        if (requestId !== destinationRequestIdRef.current) {
          return;
        }

        setDestinationSuggestions([]);
        setDestinationSearchError(
          error instanceof Error ? error.message : "Unable to load live place suggestions."
        );
      } finally {
        if (!controller.signal.aborted && requestId === destinationRequestIdRef.current) {
          setIsSearchingDestinations(false);
        }
      }
    }, DESTINATION_SEARCH_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [destinationSearch]);

  const sortedRoutes = useMemo(() => {
    return [...routes].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }, [routes]);

  const jeepneyRoutes = useMemo(() => {
    return sortedRoutes.filter((route) => !isInterimBusRoute(route));
  }, [sortedRoutes]);

  const busRoutes = useMemo(() => {
    return sortedRoutes.filter((route) => isInterimBusRoute(route));
  }, [sortedRoutes]);

  const busRouteGroups = useMemo(() => groupBusRoutes(busRoutes), [busRoutes]);
  const activeRoutes = routeMode === "bus" ? busRoutes : jeepneyRoutes;
  const displayRoutes = routeMode === "bus" ? busRouteGroups.map((group) => group.routes[0]) : jeepneyRoutes;

  const filteredRoutes = useMemo(() => {
    const normalizedSearch = search.toLowerCase();

    if (routeMode === "bus") {
      return displayRoutes.filter((route) => {
        const routeCode = getRouteCode(route);
        return (
          route.name.toLowerCase().includes(normalizedSearch) ||
          routeCode.toLowerCase().includes(normalizedSearch)
        );
      });
    }

    return activeRoutes.filter((route) =>
      route.name.toLowerCase().includes(normalizedSearch)
    );
  }, [activeRoutes, displayRoutes, routeMode, search]);

  const suggestedRouteMatches = useMemo<RouteMatch[]>(() => {
    if (!selectedDestination) {
      return [];
    }

    if (routeMode === "bus") {
      return busRouteGroups
        .map((group) => {
          const bestMatch = group.routes
            .map((route) => ({
              route,
              distanceMeters: routeMatchDistanceMeters(route, selectedDestination),
            }))
            .sort((a, b) => a.distanceMeters - b.distanceMeters)[0];

          return bestMatch ?? null;
        })
        .filter(
          (match): match is RouteMatch =>
            Boolean(match && match.distanceMeters <= DESTINATION_MATCH_RADIUS_METERS)
        )
        .sort((a, b) =>
          getRouteCode(a.route).localeCompare(getRouteCode(b.route), undefined, {
            sensitivity: "base",
          })
        );
    }

    return activeRoutes
      .map((route) => ({
        route,
        distanceMeters: routeMatchDistanceMeters(route, selectedDestination),
      }))
      .filter(({ distanceMeters }) => distanceMeters <= DESTINATION_MATCH_RADIUS_METERS)
      .sort((a, b) =>
        a.route.name.localeCompare(b.route.name, undefined, { sensitivity: "base" })
      )
      .map(({ route, distanceMeters }) => ({
        route,
        distanceMeters,
      }));
  }, [activeRoutes, busRouteGroups, routeMode, selectedDestination]);

  const alphabeticalNearbyRoutes = useMemo(() => {
    return [...nearbyRoutes]
      .filter((route) => (routeMode === "bus" ? isInterimBusRoute(route) : !isInterimBusRoute(route)))
      .sort((a, b) =>
        a.route_name.localeCompare(b.route_name, undefined, { sensitivity: "base" })
      );
  }, [nearbyRoutes, routeMode]);

  const displaySelectedRoute = useMemo(() => {
    if (selectedRoute && activeRoutes.some((route) => route.id === selectedRoute.id)) {
      return selectedRoute;
    }

    return activeRoutes[0] ?? null;
  }, [activeRoutes, selectedRoute]);

  const displayBusVariants = useMemo(() => {
    if (routeMode !== "bus" || !displaySelectedRoute) {
      return [];
    }

    const routeCode = getRouteCode(displaySelectedRoute);

    return busRoutes
      .filter((route) => getRouteCode(route) === routeCode)
      .sort((a, b) =>
        compareRouteServicePeriod(getRouteServicePeriod(a), getRouteServicePeriod(b))
      );
  }, [busRoutes, displaySelectedRoute, routeMode]);

  const displayBusVariantIndex = useMemo(() => {
    if (!displaySelectedRoute) {
      return -1;
    }

    return displayBusVariants.findIndex((route) => route.id === displaySelectedRoute.id);
  }, [displayBusVariants, displaySelectedRoute]);

  const path = useMemo<[number, number][]>(() => {
    if (!displaySelectedRoute) {
      return [];
    }

    return getRoutePath(displaySelectedRoute);
  }, [displaySelectedRoute]);

  const busMapPositions = useMemo(() => {
    if (routeMode !== "bus") {
      return path;
    }

    return path;
  }, [path, routeMode]);

  const center: [number, number] = busMapPositions[0] ?? path[0] ?? [7.0707, 125.6123];
  const selectedRouteColor = getRouteColor(
    displaySelectedRoute?.polyline_color ?? displaySelectedRoute?.route_color
  );
  const displayRouteCode = displaySelectedRoute
    ? getRouteCode(displaySelectedRoute)
    : "";
  const displayRouteServicePeriod = displaySelectedRoute
    ? getRouteServicePeriod(displaySelectedRoute)
    : "";
  const displayRouteDescription = getRouteDescriptionText(displaySelectedRoute);
  const displayRouteSchedule = getRouteScheduleText(displaySelectedRoute);
  const displayBusStops = useMemo(() => {
    return displaySelectedRoute?.stops.filter(shouldShowStopMarker) ?? [];
  }, [displaySelectedRoute]);
  const sidebarAccentColor = routeMode === "bus" ? "#35B0AB" : "#db2777";
  const selectedSidebarTitle = displaySelectedRoute?.name ?? "";

  const handleShowInterimBus = () => {
    setRouteMode("bus");
    setSearch("");
    setSelectedBusStop(null);
    setHasSelectedRoute(false);
    setNearbyRoutesMessage("Tap Find Nearby Bus Routes to use your location.");
    setNearbyRoutesError("");
    setNearbySidebarOpen(false);
  };

  const handleShowJeepneys = () => {
    setRouteMode("jeepney");
    setSearch("");
    setSelectedBusStop(null);
    setHasSelectedRoute(false);
    setNearbyRoutesMessage("Tap Find Nearby Jeepneys to use your location.");
    setNearbyRoutesError("");
  };

  const handleSelectRoute = (route: CommuteRoute) => {
    setSelectedRoute(route);
    setSelectedBusStop(null);
    setHasSelectedRoute(true);
  };

  const handleSwitchBusVariant = () => {
    if (displayBusVariants.length < 2 || displayBusVariantIndex < 0) {
      return;
    }

    const nextRoute =
      displayBusVariants[(displayBusVariantIndex + 1) % displayBusVariants.length];
    handleSelectRoute(nextRoute);
  };

  const selectDestination = (destination: PlaceSuggestion) => {
    setSelectedDestination(destination);
    setDestinationSearch(destination.label);
    setDestinationSuggestions([]);
    setDestinationDropdownOpen(false);
    setDestinationResultsOpen(true);
    setDestinationSearchError("");
    setDestinationActiveIndex(-1);
  };

  const clearDestinationSearch = () => {
    setDestinationSearch("");
    setDestinationSuggestions([]);
    setDestinationSearchError("");
    setIsSearchingDestinations(false);
    setSelectedDestination(null);
    setDestinationDropdownOpen(false);
    setDestinationResultsOpen(true);
    setDestinationActiveIndex(-1);
  };

  const handleDestinationKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      clearDestinationSearch();
      return;
    }

    if (!destinationDropdownOpen || destinationSuggestions.length === 0) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setDestinationActiveIndex((currentIndex) =>
        Math.min(
          destinationSuggestions.length - 1,
          currentIndex < 0 ? 0 : currentIndex + 1
        )
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setDestinationActiveIndex((currentIndex) =>
        Math.max(0, currentIndex < 0 ? 0 : currentIndex - 1)
      );
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setDestinationActiveIndex(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setDestinationActiveIndex(destinationSuggestions.length - 1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const nextDestination =
        destinationSuggestions[destinationActiveIndex] ?? destinationSuggestions[0];

      if (nextDestination) {
        selectDestination(nextDestination);
      }
    }
  };

  const fetchNearbyRoutes = async (
    position: [number, number]
  ): Promise<NearbyRoute[] | null> => {
    const [latitude, longitude] = position;
    const requestId = ++nearbyRequestIdRef.current;

    setIsFetchingNearbyRoutes(true);
    setNearbyRoutesError("");
    setNearbyRoutesMessage(
      routeMode === "bus" ? "Finding nearby bus routes..." : "Finding nearby jeepneys..."
    );

    try {
      const response = await fetch(
        `/api-proxy/routes/nearby?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}&radius=${encodeURIComponent(DEFAULT_NEARBY_RADIUS_METERS)}`,
        {
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        }
      );

      if (requestId !== nearbyRequestIdRef.current) {
        return null;
      }

      if (!response.ok) {
        throw new Error(
          routeMode === "bus"
            ? "Unable to load nearby bus routes right now."
            : "Unable to load nearby jeepneys right now."
        );
      }

      const data = (await response.json()) as {
        routes?: NearbyRoute[];
      };

      const routesData = Array.isArray(data.routes)
        ? data.routes
            .filter((route): route is NearbyRoute => {
              return Boolean(
                route &&
                  typeof route.route_id === "number" &&
                  typeof route.route_name === "string" &&
                  typeof route.route_code === "string" &&
                  typeof route.start_point === "string" &&
                  typeof route.end_point === "string" &&
                  typeof route.distance_meters === "number" &&
                  typeof route.nearby_stop_count === "number" &&
                  route.nearest_stop &&
                  typeof route.nearest_stop.id === "number"
              );
            })
            .map((route) => ({
              ...route,
              route_description: route.route_description ?? route.description ?? null,
              schedule: typeof route.schedule === "string" ? route.schedule : null,
              route_color:
                typeof route.route_color === "string" && route.route_color.trim() !== ""
                  ? route.route_color
                  : null,
              polyline_color:
                typeof route.polyline_color === "string" && route.polyline_color.trim() !== ""
                  ? route.polyline_color
                  : null,
            }))
        : [];

      setNearbyRoutes(routesData);

      setNearbyRoutesMessage(
        routesData.length > 0
          ? "Nearby routes based on your location."
          : routeMode === "bus"
            ? "No nearby bus routes found."
            : "No nearby jeepneys found."
      );

      return routesData;
    } catch (error) {
      if (requestId !== nearbyRequestIdRef.current) {
        return null;
      }

      setNearbyRoutes([]);
      setNearbyRoutesMessage("");
      setNearbySidebarOpen(false);

      setNearbyRoutesError(
        error instanceof Error
          ? error.message
          : routeMode === "bus"
            ? "Unable to load nearby bus routes right now."
            : "Unable to load nearby jeepneys right now."
      );
      setLocationError(
        error instanceof Error
          ? error.message
          : routeMode === "bus"
            ? "Unable to load nearby bus routes right now."
            : "Unable to load nearby jeepneys right now."
      );
      return null;
    } finally {
      if (requestId === nearbyRequestIdRef.current) {
        setIsFetchingNearbyRoutes(false);
      }
    }
  };

  const getCurrentPosition = () =>
    new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      });
    });

  const isGeolocationPositionError = (
    error: unknown
  ): error is GeolocationPositionError => {
    return (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "number"
    );
  };

  const turnOffLocation = () => {
    setUserLocation(null);
    setNearbyRoutes([]);
    setNearbyRoutesLoaded(false);
    setNearbyRoutesError("");
    setNearbyRoutesMessage(
      routeMode === "bus"
        ? "Tap Find Nearby Bus Routes to use your location."
        : "Tap Find Nearby Jeepneys to use your location."
    );
    setLocationError("");
    setNearbySidebarOpen(false);
  };

  const showCurrentLocationWithSweetAlert = async () => {
    if (userLocation) {
      return;
    }

    const swal = await getNearbySwal();

    if (!navigator.geolocation) {
      await swal.fire({
        title: "Unable to Get Location",
        text: "Please check your device location settings and try again.",
        icon: "error",
        confirmButtonText: "Okay",
        buttonsStyling: false,
        customClass: nearbySwalCustomClass,
        iconColor: nearbySwalIconColor,
      });
      return;
    }

    const permissionResult = await swal.fire({
      title: "Enable Location Access",
      html:
        routeMode === "bus"
          ? "DAVCOM Guide uses your location to find bus routes near you. Your location is only used for route suggestions and is not stored."
          : "DAVCOM Guide uses your location to find jeepney routes near you. Your location is only used for route suggestions and is not stored.",
      icon: "question",
      showCancelButton: true,
      buttonsStyling: false,
      customClass: {
        ...nearbySwalCustomClass,
        actions: "swal2-actions !mt-5 !gap-3",
        confirmButton: `${nearbySwalCustomClass.confirmButton} !mr-2`,
        cancelButton: `${nearbySwalCustomClass.cancelButton} !ml-2`,
      },
      confirmButtonText: "Allow Location",
      cancelButtonText: "Cancel",
      reverseButtons: false,
      iconColor: nearbySwalIconColor,
    });

    if (!permissionResult.isConfirmed) {
      return;
    }

    void swal.fire({
      title: "Finding Your Location",
      text: "Please wait while we locate your current position.",
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => {
        swal.showLoading();
      },
      showConfirmButton: false,
      buttonsStyling: false,
      customClass: nearbySwalCustomClass,
      iconColor: nearbySwalIconColor,
    });

    try {
      const position = await getCurrentPosition();
      setUserLocation([position.coords.latitude, position.coords.longitude]);
      setLocationError("");
      swal.close();
    } catch (error) {
      swal.close();
      const denied = isGeolocationPositionError(error) && error.code === 1;

      await swal.fire({
        title: denied ? "Location Access Required" : "Unable to Get Location",
        text: denied
          ? routeMode === "bus"
            ? "Please allow location access to discover nearby bus routes."
            : "Please allow location access to discover nearby jeepney routes."
          : "Please check your device location settings and try again.",
        icon: denied ? "warning" : "error",
        confirmButtonText: "Try Again",
        buttonsStyling: false,
        customClass: nearbySwalCustomClass,
        iconColor: nearbySwalIconColor,
      });

      setLocationError(
        denied
          ? routeMode === "bus"
            ? "Please allow location access to discover nearby bus routes."
            : "Please allow location access to discover nearby jeepney routes."
          : "Please check your device location settings and try again."
      );
    }
  };

  const toggleLocationWithSweetAlert = async () => {
    if (userLocation) {
      turnOffLocation();
      return;
    }

    await showCurrentLocationWithSweetAlert();
  };

  const handleFindNearbyJeepneys = async () => {
    if (userLocation && nearbyRoutesLoaded) {
      setNearbySidebarOpen(true);
      return;
    }

    if (userLocation) {
      const swal = await getNearbySwal();

      setNearbySidebarOpen(true);
      setNearbyRoutesError("");
      setNearbyRoutesMessage(
        routeMode === "bus" ? "Finding nearby bus routes..." : "Finding nearby jeepneys..."
      );

      void swal.fire({
        title: routeMode === "bus" ? "Finding Nearby Bus Routes" : "Finding Nearby Jeepneys",
        text: "Please wait while we locate nearby routes.",
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => {
          swal.showLoading();
        },
        showConfirmButton: false,
        buttonsStyling: false,
        customClass: nearbySwalCustomClass,
        iconColor: nearbySwalIconColor,
      });

      const nearbyRoutesResult = await fetchNearbyRoutes(userLocation);
      swal.close();
      setNearbyRoutesLoaded(true);

      if (nearbyRoutesResult === null) {
        setNearbyRoutes([]);
        setNearbyRoutesMessage("");
        setNearbyRoutesError("Please check your device location settings and try again.");
        setNearbySidebarOpen(false);
      } else if (nearbyRoutesResult.length === 0) {
        setNearbySidebarOpen(true);
      } else {
        setNearbySidebarOpen(true);
      }

      return;
    }

    const swal = await getNearbySwal();

    if (!navigator.geolocation) {
      await swal.fire({
        title: "Unable to Get Location",
        text: "Please check your device location settings and try again.",
        icon: "error",
        confirmButtonText: "Okay",
        buttonsStyling: false,
        customClass: nearbySwalCustomClass,
        iconColor: nearbySwalIconColor,
      });
      return;
    }

    const permissionResult = await swal.fire({
      title: "Enable Location Access",
      html:
        routeMode === "bus"
          ? "DAVCOM Guide uses your location to find bus routes near you. Your location is only used for route suggestions and is not stored."
          : "DAVCOM Guide uses your location to find jeepney routes near you. Your location is only used for route suggestions and is not stored.",
      icon: "question",
      showCancelButton: true,
      buttonsStyling: false,
      customClass: {
        ...nearbySwalCustomClass,
        actions: "swal2-actions !mt-5 !gap-3",
        confirmButton: `${nearbySwalCustomClass.confirmButton} !mr-2`,
        cancelButton: `${nearbySwalCustomClass.cancelButton} !ml-2`,
      },
      confirmButtonText: "Allow Location",
      cancelButtonText: "Cancel",
      reverseButtons: false,
      iconColor: nearbySwalIconColor,
    });

    if (!permissionResult.isConfirmed) {
      return;
    }

    setNearbySidebarOpen(true);
    setNearbyRoutesError("");
    setNearbyRoutesMessage(
      routeMode === "bus" ? "Finding nearby bus routes..." : "Finding nearby jeepneys..."
    );

    void swal.fire({
      title: routeMode === "bus" ? "Finding Nearby Bus Routes" : "Finding Nearby Jeepneys",
      text: "Please wait while we locate nearby routes.",
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => {
        swal.showLoading();
      },
      showConfirmButton: false,
      buttonsStyling: false,
      customClass: nearbySwalCustomClass,
      iconColor: nearbySwalIconColor,
    });

    try {
      const position = await getCurrentPosition();
      const coordinates: [number, number] = [
        position.coords.latitude,
        position.coords.longitude,
      ];

      setUserLocation(coordinates);
      setLocationError("");
      const nearbyRoutesResult = await fetchNearbyRoutes(coordinates);
      swal.close();
      setNearbyRoutesLoaded(true);

      if (nearbyRoutesResult === null) {
        setNearbyRoutes([]);
        setNearbyRoutesMessage("");
        setNearbyRoutesError("Please check your device location settings and try again.");
        setNearbySidebarOpen(false);
      } else if (nearbyRoutesResult.length === 0) {
        setNearbySidebarOpen(true);
      } else {
        setNearbySidebarOpen(true);
      }
    } catch (error) {
      swal.close();

      const denied = isGeolocationPositionError(error) && error.code === 1;
      const modalResult = await swal.fire({
        title: denied ? "Location Access Required" : "Unable to Get Location",
        text: denied
          ? routeMode === "bus"
            ? "Please allow location access to discover nearby bus routes."
            : "Please allow location access to discover nearby jeepney routes."
          : "Please check your device location settings and try again.",
        icon: denied ? "warning" : "error",
        confirmButtonText: "Try Again",
        buttonsStyling: false,
        customClass: nearbySwalCustomClass,
        iconColor: nearbySwalIconColor,
      });

      setNearbyRoutes([]);
      setNearbyRoutesMessage("");
      setNearbyRoutesError(
        denied
          ? routeMode === "bus"
            ? "Please allow location access to discover nearby bus routes."
            : "Please allow location access to discover nearby jeepney routes."
          : "Please check your device location settings and try again."
      );
      setLocationError(
        denied
          ? routeMode === "bus"
            ? "Please allow location access to discover nearby bus routes."
            : "Please allow location access to discover nearby jeepney routes."
          : "Please check your device location settings and try again."
      );

      if (modalResult.isConfirmed) {
        void handleFindNearbyJeepneys();
      }
    }
  };

  const handleSelectNearbyRoute = (nearbyRoute: NearbyRoute) => {
    const route = routes.find((item) => item.id === nearbyRoute.route_id);

    if (route) {
      handleSelectRoute(route);
    }
  };

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-gradient-to-br from-slate-50 via-pink-50 to-indigo-50">
      <div className="flex h-full w-full">
        <aside
          style={{
            WebkitOverflowScrolling: "touch",
            overscrollBehaviorY: "contain",
            touchAction: "pan-y",
          }}
          className={`sidebar-scroll fixed inset-x-0 bottom-[calc(0.5rem+env(safe-area-inset-bottom))] top-auto z-[1200] flex h-[38dvh] max-h-[38dvh] flex-col overflow-hidden rounded-t-3xl border-t border-white/40 bg-white/85 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-xl transition-transform duration-300 ease-out md:absolute md:inset-auto md:left-0 md:top-0 md:h-full md:max-h-none md:w-[360px] md:max-w-[92vw] md:rounded-none md:border-r md:border-t-0 md:p-5 ${
            sidebarOpen
              ? "translate-y-0 md:translate-x-0 md:translate-y-0"
              : "translate-y-full md:-translate-x-full md:translate-y-0"
          } ${sidebarOpen ? "pointer-events-auto" : "pointer-events-none"}`}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-16 -top-16 h-52 w-52 rounded-full bg-pink-200/40 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-16 right-0 h-52 w-52 rounded-full bg-indigo-200/40 blur-3xl"
          />

          <div className="sidebar-scroll relative flex flex-1 min-h-0 flex-col overflow-y-auto overflow-x-hidden pr-1">
          <div className="relative mb-5 rounded-3xl border border-white/50 bg-white/70 p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-white/90 shadow-sm ring-1 ring-slate-100 md:h-10 md:w-10">
                  <Image
                    src="/Davcom.svg"
                    alt="DavCom Guide logo"
                    width={40}
                    height={40}
                    className="h-6 w-6 object-contain md:h-8 md:w-8"
                    unoptimized
                    priority
                  />
                </div>
                <div className="min-w-0">
                  <h1 className="whitespace-nowrap bg-gradient-to-r from-pink-500 to-black bg-clip-text text-lg font-black tracking-tight text-transparent md:text-xl">
                    DavCom Guide
                  </h1>
                  <p className="mt-0.5 whitespace-nowrap text-xs leading-tight text-slate-600 md:text-sm">
                    Davao Commute Route Planner
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:text-pink-600 hover:shadow-md md:-translate-y-2 md:-translate-x-1"
                title="Close sidebar"
                aria-label="Close sidebar"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12" />
                  <path d="M18 6 6 18" />
                </svg>
              </button>
            </div>
          </div>

          {hasSelectedRoute && selectedSidebarTitle && sidebarOpen && (
            <div className="mb-3 md:hidden">
              <div
                className="w-full rounded-[1.25rem] border px-4 py-3 shadow-[0_18px_42px_-28px_rgba(15,23,42,0.65)] backdrop-blur-xl"
                style={{
                  borderColor: `${sidebarAccentColor}33`,
                  background: `linear-gradient(135deg, ${sidebarAccentColor}18 0%, rgba(255,255,255,0.96) 42%, rgba(255,255,255,0.88) 100%)`,
                  boxShadow: `0 18px 42px -28px ${sidebarAccentColor}66`,
                }}
              >
                <h2
                  className="truncate text-[14px] font-black tracking-tight bg-clip-text text-transparent"
                  style={{
                    backgroundImage: `linear-gradient(90deg, ${sidebarAccentColor} 0%, #0f172a 100%)`,
                  }}
                >
                  {selectedSidebarTitle}
                </h2>
              </div>
            </div>
          )}

          <div className="relative mb-4">
            <svg
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-white/80 py-3 pl-11 pr-4 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-pink-300 focus:ring-2 focus:ring-pink-100"
              placeholder={routeMode === "bus" ? "Search bus route..." : "Search jeepney route..."}
            />
          </div>

          <div className="mb-4 rounded-3xl border border-white/60 bg-white/80 p-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pink-700">
              {routeMode === "bus" ? "Nearby Bus Routes" : "Nearby Jeepneys"}
            </p>
            <h2 className="mt-1 text-lg font-black text-slate-900">Find routes near you</h2>

            <button
              onClick={handleFindNearbyJeepneys}
              disabled={isFetchingNearbyRoutes}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-gradient-to-r from-pink-500 to-black px-4 py-3 text-sm font-semibold text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isFetchingNearbyRoutes ? (
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <SearchSpinner className="h-4 w-4 border-white/60 border-r-transparent" />
                  <span>
                    {routeMode === "bus"
                      ? "Finding nearby bus routes..."
                      : "Finding nearby jeepneys..."}
                  </span>
                </span>
              ) : (
                <span className="whitespace-nowrap">
                  {routeMode === "bus" ? "Find Nearby Bus Routes" : "Find Nearby Jeepneys"}
                </span>
              )}
            </button>
          </div>

          <div className="mb-4 rounded-3xl border border-white/60 bg-white/80 p-4 shadow-sm">
            {routeMode === "bus" ? (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                  Interim Bus Routes
                </p>
                <h2 className="mt-1 text-lg font-black text-slate-900">DC Interim Bus routes</h2>
                <p className="mt-1 text-xs text-slate-600">
                  Showing all Interim routes.
                </p>
              </>
            ) : (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                  Davao City Interim Bus
                </p>
                <h2 className="mt-1 text-lg font-black text-slate-900">DC Interim Bus</h2>
                <p className="mt-1 text-xs text-slate-600">
                  Tap the button to show all bus routes.
                </p>
              </>
            )}

            {routeMode === "bus" ? (
              <button
                onClick={handleShowJeepneys}
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 hover:shadow-md"
              >
                Back to Jeepneys
              </button>
            ) : (
              <button
                onClick={handleShowInterimBus}
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-gradient-to-r from-[#35B0AB] to-black px-4 py-3 text-sm font-semibold text-white shadow-lg transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
              >
                DC Interim Bus
              </button>
            )}
          </div>

          {nearbySidebarOpen ? (
            <div className="rounded-3xl border border-white/60 bg-white/80 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-pink-700">
                    {routeMode === "bus" ? "Nearby Bus Routes" : "Nearby Jeepneys"}
                  </p>
                  <h2 className="mt-1 text-lg font-black text-slate-900">Nearby routes</h2>
                </div>

                <button
                  onClick={() => setNearbySidebarOpen(false)}
                  className="inline-flex h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-pink-200 hover:bg-pink-50 hover:text-pink-700"
                  aria-label="Cancel"
                  title="Cancel"
                >
                  Cancel
                </button>
              </div>

              <div className="mt-4">
                {isFetchingNearbyRoutes ? (
                  <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    <SearchSpinner className="h-4 w-4" />
                    <span>
                      {nearbyRoutesMessage ||
                        (routeMode === "bus"
                          ? "Finding nearby bus routes..."
                          : "Finding nearby jeepneys...")}
                    </span>
                  </div>
                ) : nearbyRoutesError ? (
                  <div className="rounded-2xl border border-pink-100 bg-pink-50 px-4 py-3 text-sm font-medium text-pink-600">
                    {nearbyRoutesError}
                  </div>
                ) : alphabeticalNearbyRoutes.length > 0 ? (
                  <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
                    {alphabeticalNearbyRoutes.map((nearbyRoute) => {
                      const isSelected = displaySelectedRoute?.id === nearbyRoute.route_id;

                      return (
                        <button
                          type="button"
                          key={nearbyRoute.route_id}
                          onClick={() => handleSelectNearbyRoute(nearbyRoute)}
                          className={`w-full rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition-all duration-200 ease-out ${
                            isSelected
                              ? "border-transparent bg-gradient-to-r from-pink-500 to-black text-white shadow-[0_16px_36px_-20px_rgba(15,23,42,0.85)] scale-[1.02]"
                              : "border-slate-200 bg-white text-slate-900 hover:-translate-y-0.5 hover:border-transparent hover:bg-[linear-gradient(135deg,#F9D5D3_0%,#2F3A44_100%)] hover:text-white hover:shadow-lg hover:scale-[1.02]"
                          }`}
                        >
                          <span className="block truncate">{nearbyRoute.route_name}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                    {nearbyRoutesMessage ||
                      (routeMode === "bus" ? "No nearby bus routes found." : "No nearby jeepneys found.")}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {routeMode === "bus" && displaySelectedRoute && (
                <div className="rounded-3xl border border-white/70 bg-white/90 p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#35B0AB]">
                        Bus Details
                      </p>
                      <h2 className="mt-1 text-lg font-black text-slate-900">
                        {displayRouteCode}
                      </h2>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-[#35B0AB]/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[#257f7b]">
                          {displayRouteServicePeriod || "BUS"}
                        </span>
                        {displaySelectedRoute.name !== displayRouteCode && (
                          <span className="text-xs font-medium text-slate-500">
                            {displaySelectedRoute.name}
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className="mt-1 inline-flex h-4 w-4 rounded-full border border-white shadow-sm"
                      style={{
                        backgroundColor: getRouteColor(
                          displaySelectedRoute.polyline_color ?? displaySelectedRoute.route_color
                        ),
                      }}
                      aria-hidden="true"
                    />
                  </div>

                  {displayBusVariants.length > 1 && (
                    <div className="mt-4 inline-flex items-center overflow-hidden rounded-2xl border border-[#35B0AB]/20 bg-[#35B0AB]/5 p-1 shadow-sm">
                      <button
                        type="button"
                        onClick={() => handleSelectRoute(displayBusVariants[0])}
                        className={`rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] transition ${
                          displayBusVariantIndex === 0
                            ? "bg-white text-[#257f7b] shadow-sm"
                            : "text-[#257f7b]/70 hover:bg-white/70"
                        }`}
                      >
                        {getRouteServicePeriod(displayBusVariants[0]) || "AM"}
                      </button>
                      <button
                        type="button"
                        onClick={handleSwitchBusVariant}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#257f7b] shadow-sm transition hover:bg-[#35B0AB]/10"
                        aria-label="Switch bus variant"
                        title="Switch bus variant"
                      >
                        <SwapIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectRoute(displayBusVariants[1])}
                        className={`rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] transition ${
                          displayBusVariantIndex === 1
                            ? "bg-white text-[#257f7b] shadow-sm"
                            : "text-[#257f7b]/70 hover:bg-white/70"
                        }`}
                      >
                        {getRouteServicePeriod(displayBusVariants[1]) || "PM"}
                      </button>
                    </div>
                  )}

                  <div className="mt-3 space-y-2 text-sm text-slate-700">
                    <div className="rounded-2xl bg-slate-50 px-3 py-2">
                      <span className="font-semibold text-slate-900">Description:</span>{" "}
                      {displayRouteDescription || "No description added yet."}
                    </div>
                    <div className="rounded-2xl bg-slate-50 px-3 py-2">
                      <span className="font-semibold text-slate-900">Schedule:</span>{" "}
                      {displayRouteSchedule}
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Bus Stops
                    </p>
                    <div className="mt-2 space-y-2">
                      {displayBusStops.length > 0 ? (
                        displayBusStops.map((stop, index) => {
                          const stopPosition: [number, number] = [
                            Number(stop.latitude),
                            Number(stop.longitude),
                          ];
                          const isSelectedStop =
                            selectedBusStop?.[0] === stopPosition[0] &&
                            selectedBusStop?.[1] === stopPosition[1];

                          return (
                            <button
                              key={stop.id}
                              type="button"
                              onClick={() => setSelectedBusStop(stopPosition)}
                              className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left text-sm transition ${
                                isSelectedStop
                                  ? "border-[#35B0AB] bg-[#35B0AB]/10 text-slate-900"
                                  : "border-slate-200 bg-white text-slate-700 hover:border-[#35B0AB]/30 hover:bg-slate-50"
                              }`}
                            >
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#35B0AB] text-xs font-bold text-white">
                                {index + 1}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-medium">
                                {stop.name}
                              </span>
                            </button>
                          );
                        })
                      ) : (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                          No stops added yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {routeMode !== "bus" && (
                <div className="mb-3 flex items-center gap-3 px-1">
                  <div className="h-px flex-1 bg-gradient-to-r from-pink-300 via-pink-200 to-transparent" />
                  <p className="text-[11px] font-black uppercase tracking-[0.2em] text-pink-700">
                    Davao Jeepneys
                  </p>
                  <div className="h-px flex-1 bg-gradient-to-l from-pink-300 via-pink-200 to-transparent" />
                </div>
              )}

              {filteredRoutes.map((route) => (
                (() => {
                  const routeCode = getRouteCode(route);
                  const isSelected = routeMode === "bus"
                    ? (displaySelectedRoute ? getRouteCode(displaySelectedRoute).toLowerCase() : "") ===
                      routeCode.toLowerCase()
                    : displaySelectedRoute?.id === route.id;

                  return (
                    <button
                      type="button"
                      key={route.id}
                      onClick={() => handleSelectRoute(route)}
                      className={`w-full rounded-2xl border p-4 text-left shadow-sm transition ${
                        isSelected
                          ? "border-pink-300 bg-gradient-to-r from-pink-50 to-indigo-50"
                          : "border-slate-200 bg-white/90 hover:-translate-y-0.5 hover:border-pink-200 hover:bg-white"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div>
                          <h2 className="font-bold text-slate-900">
                            {routeMode === "bus" ? routeCode : route.name}
                          </h2>
                          {routeMode === "bus" && (
                            <p className="mt-1 text-xs text-slate-500">
                              {getRouteDescriptionText(route) || "No details added yet."}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })()
              ))}
              {filteredRoutes.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-4 text-sm text-slate-500">
                  No route matched your search.
                </div>
              )}
            </div>
          )}
          </div>
        </aside>

        {hasSelectedRoute && selectedSidebarTitle && (
          <div
            className={`pointer-events-none absolute z-[1250] hidden transition-all duration-300 ease-out md:block ${
              sidebarOpen
                ? "top-4 left-4 md:top-5 md:left-[calc(360px+1rem)]"
                : "bottom-6 left-[4.75rem] top-auto md:bottom-auto md:left-[4.75rem] md:top-6"
            }`}
          >
            <div
              className="max-w-[min(80vw,18rem)] rounded-[1.4rem] border px-4 py-3 shadow-[0_18px_42px_-28px_rgba(15,23,42,0.65)] backdrop-blur-xl md:max-w-[240px]"
              style={{
                borderColor: `${sidebarAccentColor}33`,
                background: `linear-gradient(135deg, ${sidebarAccentColor}18 0%, rgba(255,255,255,0.96) 42%, rgba(255,255,255,0.88) 100%)`,
                boxShadow: `0 18px 42px -28px ${sidebarAccentColor}66`,
              }}
            >
              <h2
                className="truncate text-[15px] font-black tracking-tight md:text-base bg-clip-text text-transparent"
                style={{
                  backgroundImage: `linear-gradient(90deg, ${sidebarAccentColor} 0%, #0f172a 100%)`,
                }}
              >
                {selectedSidebarTitle}
              </h2>
            </div>
          </div>
        )}

        {hasSelectedRoute && selectedSidebarTitle && !sidebarOpen && (
          <div className="pointer-events-none absolute bottom-[calc(4.25rem+env(safe-area-inset-bottom))] left-[0.75rem] z-[1250] md:hidden">
            <div
              className="max-w-[min(78vw,16rem)] rounded-[1.2rem] border px-4 py-3 shadow-[0_18px_42px_-28px_rgba(15,23,42,0.65)] backdrop-blur-xl"
              style={{
                borderColor: `${sidebarAccentColor}33`,
                background: `linear-gradient(135deg, ${sidebarAccentColor}18 0%, rgba(255,255,255,0.96) 42%, rgba(255,255,255,0.88) 100%)`,
                boxShadow: `0 18px 42px -28px ${sidebarAccentColor}66`,
              }}
            >
              <h2
                className="truncate text-[14px] font-black tracking-tight bg-clip-text text-transparent"
                style={{
                  backgroundImage: `linear-gradient(90deg, ${sidebarAccentColor} 0%, #0f172a 100%)`,
                }}
              >
                {selectedSidebarTitle}
              </h2>
            </div>
          </div>
        )}

        <section className="relative h-full min-w-0 flex-1">
          <div
            ref={destinationSearchRef}
            className="absolute left-1/2 top-4 z-[1400] w-[min(92vw,22rem)] -translate-x-1/2 md:left-auto md:right-[4.5rem] md:top-6 md:w-[22rem] md:translate-x-0"
          >
            <div className="rounded-2xl border border-slate-300 bg-white/95 p-2 shadow-xl backdrop-blur-sm transition-all duration-200 hover:border-pink-200 hover:shadow-2xl focus-within:border-pink-300 focus-within:shadow-2xl">
              <div className="relative">
                <svg
                  className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  value={destinationSearch}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setDestinationSearch(nextValue);
                    setDestinationDropdownOpen(true);
                    setSelectedDestination(null);
                    setDestinationActiveIndex(-1);

                    if (nextValue.trim().length < DESTINATION_SEARCH_MIN_CHARS) {
                      setDestinationSuggestions([]);
                      setDestinationSearchError("");
                      setIsSearchingDestinations(false);
                    }
                  }}
                  onFocus={() => setDestinationDropdownOpen(true)}
                  onClick={() => setDestinationDropdownOpen(true)}
                  onKeyDown={handleDestinationKeyDown}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={destinationDropdownOpen}
                  aria-controls="destination-suggestion-list"
                  aria-activedescendant={
                    destinationActiveIndex >= 0
                      ? `destination-suggestion-${destinationActiveIndex}`
                      : undefined
                  }
                  className="w-full rounded-xl border border-slate-300 bg-white px-11 py-3 pr-28 text-sm text-black shadow-sm outline-none transition-all duration-200 placeholder:text-slate-500 hover:border-pink-200 hover:bg-white focus:border-pink-300 focus:ring-2 focus:ring-pink-100"
                  placeholder="Where are you going?"
                  aria-label="Destination search"
                />
                {selectedDestination && (
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setDestinationResultsOpen((open) => !open)}
                    className="absolute right-12 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-all duration-200 hover:border-pink-200 hover:bg-pink-50 hover:text-pink-600"
                    aria-label={
                      destinationResultsOpen ? "Hide suggested routes" : "Show suggested routes"
                    }
                    title={destinationResultsOpen ? "Hide suggested routes" : "Show suggested routes"}
                  >
                    <ChevronToggleIcon expanded={destinationResultsOpen} />
                  </button>
                )}
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={clearDestinationSearch}
                  className={`absolute right-3 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-all duration-200 hover:border-pink-200 hover:bg-pink-50 hover:text-pink-600 ${
                    destinationSearch.trim().length > 0
                      ? "scale-100 opacity-100"
                      : "pointer-events-none scale-75 opacity-0"
                  }`}
                  aria-label="Clear destination search"
                  title="Clear search"
                >
                  <svg
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    aria-hidden="true"
                  >
                    <path d="M18 6 6 18" />
                    <path d="M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div
                className={`overflow-hidden transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  destinationDropdownOpen
                    ? "mt-2 max-h-72 translate-y-0 opacity-100"
                    : "max-h-0 -translate-y-2 opacity-0 pointer-events-none"
                }`}
              >
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-lg">
                  <div
                    id="destination-suggestion-list"
                    role="listbox"
                    className="max-h-72 overflow-y-auto p-2"
                  >
                    {destinationSearch.trim().length < DESTINATION_SEARCH_MIN_CHARS ? (
                      <div className="px-4 py-3 text-sm text-slate-600">
                        Try places like Abreeza, Azuela Cove or SM.
                      </div>
                    ) : isSearchingDestinations ? (
                      <div className="flex items-center gap-2 px-4 py-3 text-sm text-black">
                        <SearchSpinner />
                        <span>Searching places...</span>
                      </div>
                    ) : destinationSearchError ? (
                      <div className="px-4 py-3 text-sm text-pink-600">
                        {destinationSearchError}
                      </div>
                    ) : destinationSuggestions.length > 0 ? (
                      destinationSuggestions.map((destination, index) => {
                        const isActive = destinationActiveIndex === index;

                        return (
                          <button
                            id={`destination-suggestion-${index}`}
                            role="option"
                            aria-selected={isActive}
                            key={`${destination.label}-${destination.latitude}-${destination.longitude}`}
                            onClick={() => selectDestination(destination)}
                            className={`group mb-2 block w-full rounded-2xl border px-4 py-3 text-left transition-all duration-200 ease-out last:mb-0 ${
                              isActive
                                ? "border-transparent bg-gradient-to-r from-pink-500 to-black text-white shadow-[0_14px_32px_-18px_rgba(15,23,42,0.8)] scale-[1.02]"
                                : "border-slate-200 bg-white text-slate-900 hover:-translate-y-0.5 hover:border-transparent hover:bg-[linear-gradient(135deg,#F9D5D3_0%,#2F3A44_100%)] hover:text-white hover:shadow-lg hover:scale-[1.02]"
                            }`}
                          >
                            <div className="text-sm font-medium">{destination.name}</div>
                            <div
                              className={`mt-0.5 text-xs transition-colors duration-200 ${
                                isActive
                                  ? "text-white/80"
                                  : "text-slate-500 group-hover:text-white/80"
                              }`}
                            >
                              {destination.label}
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-4 py-3 text-sm text-black">No places found.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div
              className={`overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                selectedDestination && destinationResultsOpen
                  ? "mt-2 max-h-[30rem] translate-y-0 opacity-100"
                  : "max-h-0 -translate-y-2 opacity-0 pointer-events-none"
              }`}
            >
              <div className="rounded-2xl border border-slate-300 bg-white/95 p-4 shadow-xl backdrop-blur-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">
                      {routeMode === "bus" ? "Suggested buses" : "Suggested jeepneys"}
                    </p>
                    <h3 className="mt-1 text-base font-bold text-black">
                      {selectedDestination?.name ?? "Choose a place"}
                    </h3>
                  </div>
                </div>

                {selectedDestination && suggestedRouteMatches.length > 0 ? (
                  <div className="mt-4 max-h-64 space-y-2 overflow-y-auto pb-1 pr-1">
                    {suggestedRouteMatches.map((match) => {
                      const isSelected = displaySelectedRoute?.id === match.route.id;

                      return (
                        <button
                          key={match.route.id}
                          onClick={() => handleSelectRoute(match.route)}
                          className={`w-full rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition-all duration-200 ease-out ${
                            isSelected
                              ? "border-transparent bg-gradient-to-r from-pink-500 to-black text-white shadow-[0_16px_36px_-20px_rgba(15,23,42,0.85)] scale-[1.03]"
                              : "border-slate-200 bg-white text-slate-900 hover:-translate-y-0.5 hover:border-transparent hover:bg-[linear-gradient(135deg,#F9D5D3_0%,#2F3A44_100%)] hover:text-white hover:shadow-lg hover:scale-[1.02]"
                          }`}
                        >
                          {match.route.name}
                        </button>
                      );
                    })}
                  </div>
                ) : selectedDestination ? (
                  <p className="mt-4 text-sm text-black">
                    No {routeMode === "bus" ? "bus" : "jeepney"} route passes within{" "}
                    {DESTINATION_MATCH_RADIUS_METERS} meters of this Davao place.
                  </p>
                ) : (
                  <p className="mt-4 text-sm text-black">
                    Pick a live place suggestion to see matching{" "}
                    {routeMode === "bus" ? "bus" : "jeepney"} routes.
                  </p>
                )}
              </div>
            </div>
          </div>

        {!sidebarOpen && (
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-[0.75rem] z-[1500] inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/60 bg-white/95 text-pink-600 shadow-xl backdrop-blur transition touch-manipulation hover:-translate-y-0.5 hover:bg-white md:bottom-auto md:left-6 md:top-6 md:h-10 md:w-10"
            title="Open sidebar"
            aria-label="Open sidebar"
          >
              <span className="inline-block h-3 w-4">
                <span className="mb-1 block h-[2px] w-4 rounded bg-pink-600" />
                <span className="mb-1 block h-[2px] w-4 rounded bg-pink-600" />
                <span className="block h-[2px] w-4 rounded bg-pink-600" />
              </span>
            </button>
          )}

          <div
            className={`pointer-events-none absolute right-6 z-[1000] flex flex-col items-end gap-2 transition-[bottom] duration-300 ${
              sidebarOpen
                ? "bottom-[calc(38dvh+0.75rem+env(safe-area-inset-bottom))] md:bottom-6"
                : "bottom-[calc(0.75rem+env(safe-area-inset-bottom))] md:bottom-6"
            }`}
          >
            <button
              onClick={toggleLocationWithSweetAlert}
              className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-pink-200 bg-white/95 text-pink-600 shadow-xl backdrop-blur transition hover:-translate-y-0.5 hover:bg-pink-50"
              title={userLocation ? "Turn off location" : "Show my location"}
              aria-label={userLocation ? "Turn off location" : "Show my location"}
            >
              {userLocation ? <PowerOffIcon /> : <PlaneIcon />}
            </button>

            {locationError && (
              <div className="pointer-events-auto max-w-xs rounded-2xl border border-pink-100 bg-white/95 p-3 text-sm text-pink-600 shadow-xl">
                {locationError}
              </div>
            )}
          </div>

          <div
            className={`pointer-events-none absolute left-1/2 z-[900] -translate-x-1/2 px-3 py-1 text-center text-[11px] font-medium leading-tight text-black/70 transition-[bottom] duration-300 ${
              sidebarOpen
                ? "bottom-[calc(38dvh+0.75rem+env(safe-area-inset-bottom))] md:bottom-6"
                : "bottom-[calc(0.75rem+env(safe-area-inset-bottom))] md:bottom-6"
            }`}
          >
            <span className="block">@DavCom Guide 2026</span>
            <span className="block whitespace-nowrap">Lawrence Jay Saludes</span>
          </div>

          <MapContainer
            center={center}
            zoom={13}
            scrollWheelZoom={true}
            zoomControl={false}
            className="h-full w-full"
          >
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ZoomControl position="topright" />

            {routeMode === "bus" ? (
              <>
                {busMapPositions.length > 1 && <FitToRoutePath positions={busMapPositions} />}
                {selectedBusStop && <FlyToPosition position={selectedBusStop} zoom={17} />}

                {path.length > 1 && (
                  <Polyline
                    positions={path}
                    pathOptions={{
                      color: selectedRouteColor,
                      weight: 9,
                      opacity: 0.98,
                      lineJoin: "round",
                      lineCap: "round",
                    }}
                  />
                )}
              </>
            ) : (
              path.length > 1 && (
                <>
                  <FitToRoutePath positions={path} />
                  <Polyline
                    positions={path}
                    pathOptions={{
                      color: selectedRouteColor,
                      weight: 12,
                      opacity: 0.24,
                      lineJoin: "round",
                      lineCap: "round",
                    }}
                  />
                  <Polyline
                    positions={path}
                    pathOptions={{
                      color: selectedRouteColor,
                      weight: 7,
                      opacity: 0.98,
                      lineJoin: "round",
                      lineCap: "round",
                    }}
                  />
                </>
              )
            )}

            {displaySelectedRoute?.stops
              .filter(shouldShowStopMarker)
              .map((stop, index) => (
                <Marker
                  key={stop.id}
                  position={[Number(stop.latitude), Number(stop.longitude)]}
                  icon={createRouteStopIcon(selectedRouteColor, String(index + 1))}
                >
                  <Popup>
                    <div className="space-y-1">
                      <div className="text-sm font-semibold text-slate-900">{stop.name}</div>
                    </div>
                  </Popup>
                </Marker>
              ))}

            <FlyToUserLocation position={userLocation} />

            {userLocation && (
              <Marker position={userLocation} icon={userIcon}>
                <Popup>You are here</Popup>
              </Marker>
            )}
          </MapContainer>
        </section>
      </div>
    </main>
  );
}
