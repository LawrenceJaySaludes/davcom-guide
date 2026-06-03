"use client";

import { FormEvent, useRef, useState } from "react";
import {
  MapContainer,
  Marker,
  Popup,
  Polyline,
  TileLayer,
  ZoomControl,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";

type Point = {
  lat: number;
  lng: number;
};

type DraftStop = Point & {
  id: string;
  name: string;
  is_stop: boolean;
};

type CommuteRoute = {
  id: number;
  name: string;
};

type BusVariantKey = "AM" | "PM";

type BusVariantDraft = {
  schedule: string;
  stops: DraftStop[];
};

const DEFAULT_ROUTE_COLOR = "#db2777";
const ACCENT_ROUTE_COLOR = "#35B0AB";
const BUS_VARIANT_ORDER: BusVariantKey[] = ["AM", "PM"];
const ROUTE_COLOR_OPTIONS = [
  {
    label: "Jeepney",
    value: DEFAULT_ROUTE_COLOR,
  },
  {
    label: "Interim Bus",
    value: ACCENT_ROUTE_COLOR,
  },
] as const;

function createDraftStop(point: Point, index: number, useStopLabel: boolean): DraftStop {
  return {
    id: `${Date.now()}-${index}`,
    name: useStopLabel ? `Stop ${index + 1}` : `Point ${index + 1}`,
    is_stop: useStopLabel,
    lat: point.lat,
    lng: point.lng,
  };
}

function createBusVariantDraft(): BusVariantDraft {
  return {
    schedule: "",
    stops: [],
  };
}

function createStopIcon(color: string, label: string) {
  return L.divIcon({
    className: "route-stop-marker",
    html: `
      <div style="
        width: 30px;
        height: 30px;
        border-radius: 9999px;
        border: 3px solid rgba(255,255,255,0.95);
        background: ${color};
        box-shadow: 0 12px 24px -12px rgba(15, 23, 42, 0.45);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 800;
        line-height: 1;
      ">${label}</div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

type SwalIcon = "warning" | "error" | "success" | "info";

type SwalCall = (
  title: string,
  text?: string,
  icon?: SwalIcon
) => Promise<unknown>;

type SwalWithOptions = (options: {
  title: string;
  text: string;
  icon: SwalIcon;
  buttons?: [string, string] | boolean;
  dangerMode?: boolean;
}) => Promise<unknown>;

const getSwal = async () => {
  const swalModule = await import("sweetalert");
  return ((swalModule as unknown as { default?: unknown }).default ??
    swalModule) as unknown as SwalCall & SwalWithOptions;
};

const showSwal = async (title: string, text: string, icon: SwalIcon) => {
  const swal = await getSwal();
  return swal(title, text, icon);
};

const showSwalWithOptions = async (options: {
  title: string;
  text: string;
  icon: SwalIcon;
  buttons?: [string, string] | boolean;
  dangerMode?: boolean;
}) => {
  const swal = await getSwal();
  return swal(options);
};

const getErrorMessage = async (res: Response) => {
  try {
    const data = await res.json();

    if (data?.message && typeof data.message === "string") {
      return data.message;
    }

    if (data?.errors && typeof data.errors === "object") {
      const first = Object.values(data.errors)[0];
      if (Array.isArray(first) && typeof first[0] === "string") {
        return first[0];
      }
    }
  } catch {
    // Ignore parse issues and use fallback below.
  }

  return `Request failed (${res.status}).`;
};

const fetchApi = async (path: string, init?: RequestInit) => {
  const safePath = path.startsWith("/") ? path : `/${path}`;
  return fetch(`/api-proxy${safePath}`, init);
};

const TRANSIENT_VERIFY_STATUSES = new Set([502, 503, 504]);
const VERIFY_RETRY_DELAYS_MS = [0, 700, 1400];

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
      aria-hidden="true"
    />
  );
}

function ClickHandler({
  onAddPoint,
  isStopMode,
}: {
  onAddPoint: (point: Point, isStopMode: boolean) => void;
  isStopMode: boolean;
}) {
  useMapEvents({
    click(e) {
      onAddPoint(
        {
          lat: e.latlng.lat,
          lng: e.latlng.lng,
        },
        isStopMode
      );
    },
  });

  return null;
}

export default function AdminRouteEditor() {
  const [name, setName] = useState("");
  const [fare, setFare] = useState("13");
  const [routeColor, setRouteColor] = useState(DEFAULT_ROUTE_COLOR);
  const [routeDescription, setRouteDescription] = useState("");
  const [busDescription, setBusDescription] = useState("");
  const [schedule, setSchedule] = useState("");
  const [stops, setStops] = useState<DraftStop[]>([]);
  const [busRouteCode, setBusRouteCode] = useState("");
  const [activeBusVariant, setActiveBusVariant] = useState<BusVariantKey>("AM");
  const [busVariants, setBusVariants] = useState<Record<BusVariantKey, BusVariantDraft>>({
    AM: createBusVariantDraft(),
    PM: createBusVariantDraft(),
  });
  const [isStopMode, setIsStopMode] = useState(false);
  const [message, setMessage] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [routes, setRoutes] = useState<CommuteRoute[]>([]);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteSearch, setDeleteSearch] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(false);
  const [authError, setAuthError] = useState("");
  const [isFetchingRoutes, setIsFetchingRoutes] = useState(false);
  const [isSavingRoute, setIsSavingRoute] = useState(false);
  const [deletingRouteId, setDeletingRouteId] = useState<number | null>(null);
  const stopIdCounterRef = useRef(0);

  const relockAdmin = (nextMessage: string) => {
    setAdminKey("");
    setIsUnlocked(false);
    setAuthError(nextMessage);
    setIsCheckingAuth(false);
    setIsFetchingRoutes(false);
    setIsSavingRoute(false);
    setDeletingRouteId(null);
  };

  const fetchRoutes = async (keyOverride?: string) => {
    const activeKey = keyOverride ?? adminKey;

    if (!activeKey) {
      setIsFetchingRoutes(false);
      return;
    }

    setIsFetchingRoutes(true);

    try {
      const res = await fetchApi("/admin/routes-list", {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "X-Admin-Key": activeKey,
        },
      });

      if (!res.ok) {
        if (res.status === 401) {
          relockAdmin("Admin session expired. Please enter password again.");
          return;
        }

        setMessage(await getErrorMessage(res));
        return;
      }

      const data = await res.json();
      setRoutes(data);
    } catch {
      setMessage("Unable to load routes.");
    } finally {
      setIsFetchingRoutes(false);
    }
  };

  const updateActiveStops = (updater: (current: DraftStop[]) => DraftStop[]) => {
    if (routeColor === ACCENT_ROUTE_COLOR) {
      setBusVariants((current) => ({
        ...current,
        [activeBusVariant]: {
          ...current[activeBusVariant],
          stops: updater(current[activeBusVariant].stops),
        },
      }));
      return;
    }

    setStops((current) => updater(current));
  };

  const updateActiveBusVariant = (
    key: BusVariantKey,
    updater: (current: BusVariantDraft) => BusVariantDraft
  ) => {
    setBusVariants((current) => ({
      ...current,
      [key]: updater(current[key]),
    }));
  };

  const resetBusVariants = () => {
    setBusVariants({
      AM: createBusVariantDraft(),
      PM: createBusVariantDraft(),
    });
    setActiveBusVariant("AM");
    setBusRouteCode("");
  };

  const getActiveStops = () =>
    routeColor === ACCENT_ROUTE_COLOR ? busVariants[activeBusVariant].stops : stops;

  const getActiveRouteDescription = () =>
    routeColor === ACCENT_ROUTE_COLOR ? busDescription : routeDescription;

  const getActiveSchedule = () =>
    routeColor === ACCENT_ROUTE_COLOR ? busVariants[activeBusVariant].schedule : schedule;

  const verifyAdminKey = async (candidateKey: string) => {
    for (let attempt = 0; attempt < VERIFY_RETRY_DELAYS_MS.length; attempt += 1) {
      const delayMs = VERIFY_RETRY_DELAYS_MS[attempt];
      if (delayMs > 0) {
        await wait(delayMs);
      }

      try {
        const res = await fetchApi("/admin/verify", {
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "X-Admin-Key": candidateKey,
          },
        });

        if (res.ok) {
          return {
            ok: true as const,
          };
        }

        if (res.status === 401) {
          return {
            ok: false as const,
            message: "Wrong password. Please try again.",
          };
        }

        if (TRANSIENT_VERIFY_STATUSES.has(res.status) && attempt < VERIFY_RETRY_DELAYS_MS.length - 1) {
          continue;
        }

        return {
          ok: false as const,
          message: await getErrorMessage(res),
        };
      } catch {
        if (attempt < VERIFY_RETRY_DELAYS_MS.length - 1) {
          continue;
        }

        return {
          ok: false as const,
          message: "Unable to reach backend API from proxy.",
        };
      }
    }

    return {
      ok: false as const,
      message: "Unable to reach backend API from proxy.",
    };
  };

  const unlockAdmin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = adminPassword.trim();

    if (!candidate) {
      setAuthError("Please enter the admin password.");
      return;
    }

    setIsCheckingAuth(true);
    setAuthError("");

    const verification = await verifyAdminKey(candidate);

    if (!verification.ok) {
      setIsCheckingAuth(false);
      setAuthError(verification.message);
      return;
    }

    setAdminKey(candidate);
    setAdminPassword("");
    setIsUnlocked(true);
    setIsCheckingAuth(false);
    setMessage("Admin access granted.");
    void fetchRoutes(candidate);
  };

  const deleteRoute = async (id: number) => {
    if (!adminKey) {
      await showSwal("Oops!", "Admin session expired. Please log in again.", "error");
      return;
    }
    if (deletingRouteId !== null) {
      return;
    }

    const confirmed = await showSwalWithOptions({
      title: "Are you sure?",
      text: "Delete this route and its path?",
      icon: "warning",
      buttons: ["Cancel", "Delete"],
      dangerMode: true,
    });

    if (!confirmed) return;

    setDeletingRouteId(id);
    try {
      let res: Response;

      try {
        res = await fetchApi(`/routes/${id}`, {
          method: "DELETE",
          headers: {
            Accept: "application/json",
            "X-Admin-Key": adminKey,
          },
        });
      } catch {
        await showSwal("Oops!", "Unable to reach backend API. Check that backend is running.", "error");
        setMessage("Unable to reach backend API. Check that backend is running.");
        return;
      }

      if (!res.ok) {
        if (res.status === 401) {
          relockAdmin("Admin session expired. Please enter password again.");
          return;
        }

        const errorMessage = await getErrorMessage(res);
        await showSwal("Oops!", errorMessage, "error");
        setMessage(errorMessage);
        return;
      }

      setRoutes((prev) => prev.filter((route) => route.id !== id));
      await showSwal("Deleted!", "Route deleted successfully.", "success");
      setMessage("Route deleted successfully.");
      setDeleteSearch("");
    } finally {
      setDeletingRouteId(null);
    }
  };

  const addPoint = (point: Point, useStopLabel: boolean) => {
    updateActiveStops((prev) => {
      const nextIndex = prev.length;
      return [
        ...prev,
        {
          ...createDraftStop(point, nextIndex, useStopLabel),
          id: `${Date.now()}-${stopIdCounterRef.current += 1}`,
        },
      ];
    });
  };

  const updateStopName = (id: string, nameValue: string) => {
    updateActiveStops((prev) =>
      prev.map((stop) => (stop.id === id ? { ...stop, name: nameValue } : stop))
    );
  };

  const updateStopPosition = (id: string, lat: number, lng: number) => {
    updateActiveStops((prev) =>
      prev.map((stop) => (stop.id === id ? { ...stop, lat, lng } : stop))
    );
  };

  const removeStop = (id: string) => {
    updateActiveStops((prev) => prev.filter((stop) => stop.id !== id));
  };

  const undoPoint = () => {
    updateActiveStops((prev) => prev.slice(0, -1));
  };

  const clearPath = () => {
    updateActiveStops(() => []);
  };

  const saveRoute = async () => {
    if (!adminKey) {
      await showSwal("Oops!", "Admin session expired. Please log in again.", "error");
      return;
    }
    if (isSavingRoute) {
      return;
    }

    const normalizedName = name.trim();
    const isBusRoute = routeColor === ACCENT_ROUTE_COLOR;
    const parsedFare = Number.parseFloat(fare);
    const baseFare = isBusRoute ? 0 : parsedFare;
    const activeStops = isBusRoute ? busVariants[activeBusVariant].stops : stops;

    if (!isBusRoute && (!normalizedName || activeStops.length < 2)) {
      await showSwal("Oops!", "Please enter a route name and click at least 2 map points.", "error");
      setMessage("Please enter a route name and click at least 2 map points.");
      return;
    }

    if (!isBusRoute && (!Number.isFinite(parsedFare) || parsedFare < 0)) {
      await showSwal("Oops!", "Please enter a valid fare amount (0 or higher).", "error");
      setMessage("Please enter a valid fare amount (0 or higher).");
      return;
    }

    if (isBusRoute) {
      const normalizedBusCode = busRouteCode.trim();

      if (!normalizedBusCode) {
        await showSwal("Oops!", "Please enter a bus route code like r1346.", "error");
        setMessage("Please enter a bus route code like r1346.");
        return;
      }

      const missingVariant = BUS_VARIANT_ORDER.find((variantKey) => busVariants[variantKey].stops.length < 2);
      if (missingVariant) {
        await showSwal(
          "Oops!",
          `Please add at least 2 map points for the ${missingVariant} route before saving.`,
          "error"
        );
        setMessage(`Please add at least 2 map points for the ${missingVariant} route before saving.`);
        return;
      }
    }

    const routePoints = activeStops.map((stop) => ({
      lat: stop.lat,
      lng: stop.lng,
    }));
    const closedPath = routePoints.length > 1 ? [...routePoints, routePoints[0]] : routePoints;
    setIsSavingRoute(true);
    try {
      let res: Response;

      try {
        res = await fetchApi(
          isBusRoute ? "/admin/bus-routes-with-paths" : "/admin/routes-with-path",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "X-Admin-Key": adminKey,
            },
            body: JSON.stringify(
              isBusRoute
                ? {
                    route_code: busRouteCode.trim(),
                    base_fare: 0,
                    route_color: routeColor || DEFAULT_ROUTE_COLOR,
                    polyline_color: routeColor || DEFAULT_ROUTE_COLOR,
                    description: busDescription.trim() || null,
                    route_description: busDescription.trim() || null,
                    variants: BUS_VARIANT_ORDER.map((variantKey) => {
                      const variantDraft = busVariants[variantKey];
                      const variantRoutePoints = variantDraft.stops.map((stop) => ({
                        lat: stop.lat,
                        lng: stop.lng,
                      }));
                      const variantClosedPath =
                        variantRoutePoints.length > 1
                          ? [...variantRoutePoints, variantRoutePoints[0]]
                          : variantRoutePoints;

                      return {
                        service_period: variantKey,
                        schedule: variantDraft.schedule.trim() || null,
                        description: busDescription.trim() || null,
                        route_description: busDescription.trim() || null,
                        path: variantClosedPath,
                        stops: variantRoutePoints.map((point, index) => ({
                          name:
                            variantDraft.stops[index]?.name?.trim() ||
                            (variantDraft.stops[index]?.is_stop
                              ? `Stop ${index + 1}`
                              : `Point ${index + 1}`),
                          stop_name:
                            variantDraft.stops[index]?.name?.trim() ||
                            (variantDraft.stops[index]?.is_stop
                              ? `Stop ${index + 1}`
                              : `Point ${index + 1}`),
                          lat: point.lat,
                          lng: point.lng,
                          is_stop: Boolean(variantDraft.stops[index]?.is_stop),
                        })),
                      };
                    }),
                  }
                : {
                    name: normalizedName,
                    base_fare: baseFare,
                    description: routeDescription.trim() || null,
                    route_description: routeDescription.trim() || null,
                    schedule: schedule.trim() || null,
                    route_color: routeColor || DEFAULT_ROUTE_COLOR,
                    polyline_color: routeColor || DEFAULT_ROUTE_COLOR,
                    path: closedPath,
                    stops: routePoints.map((point, index) => ({
                      name:
                        stops[index]?.name?.trim() ||
                        (stops[index]?.is_stop ? `Stop ${index + 1}` : `Point ${index + 1}`),
                      stop_name:
                        stops[index]?.name?.trim() ||
                        (stops[index]?.is_stop ? `Stop ${index + 1}` : `Point ${index + 1}`),
                      lat: point.lat,
                      lng: point.lng,
                      is_stop: Boolean(stops[index]?.is_stop),
                    })),
                  }
            ),
          }
        );
      } catch {
        await showSwal("Oops!", "Unable to reach backend API. Check that backend is running.", "error");
        setMessage("Unable to reach backend API. Check that backend is running.");
        return;
      }

      if (!res.ok) {
        if (res.status === 401) {
          relockAdmin("Admin session expired. Please enter password again.");
          return;
        }

        const errorMessage = await getErrorMessage(res);
        await showSwal("Oops!", errorMessage, "error");
        setMessage(errorMessage);
        return;
      }

      void fetchRoutes();
      await showSwal("Success!", "Route saved successfully.", "success");
      setMessage("Route saved successfully.");
      setName("");
      setFare("13");
      setRouteColor(DEFAULT_ROUTE_COLOR);
      setRouteDescription("");
      setBusDescription("");
      setSchedule("");
      setStops([]);
      resetBusVariants();
      setIsStopMode(false);
    } finally {
      setIsSavingRoute(false);
    }
  };

  const activeStops = routeColor === ACCENT_ROUTE_COLOR ? busVariants[activeBusVariant].stops : stops;
  const activeBusDraft = busVariants[activeBusVariant];
  const displayPath = activeStops.length > 1 ? [...activeStops, activeStops[0]] : activeStops;
  const selectedRouteColor = routeColor || DEFAULT_ROUTE_COLOR;
  const isBusRoute = routeColor === ACCENT_ROUTE_COLOR;
  const routeNamePlaceholder = isBusRoute
    ? "Bus route code e.g. r1346"
    : "Route name e.g. Route 11";
  const routeDescriptionPlaceholder = isBusRoute
    ? "Optional bus description"
    : "Optional route description";
  const filteredRoutes = [...routes]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .filter((route) => route.name.toLowerCase().includes(deleteSearch.toLowerCase()));

  return (
    <main className="relative h-screen w-full overflow-hidden bg-gradient-to-br from-slate-50 via-rose-50 to-indigo-50">
      <div className={`h-full w-full ${isUnlocked ? "" : "pointer-events-none select-none blur-[2px]"}`}>
      <aside
        className={`sidebar-scroll fixed inset-x-0 bottom-0 z-[1200] h-[62vh] overflow-x-hidden overflow-y-auto rounded-t-3xl border-t border-white/40 bg-white/85 p-4 shadow-2xl backdrop-blur-xl transition-transform duration-300 ease-out md:absolute md:inset-auto md:left-0 md:top-0 md:h-full md:w-[360px] md:max-w-[92vw] md:rounded-none md:border-r md:border-t-0 md:p-5 ${
          sidebarOpen
            ? "translate-y-0 md:translate-x-0 md:translate-y-0"
            : "translate-y-full md:-translate-x-full md:translate-y-0"
        } ${sidebarOpen ? "pointer-events-auto" : "pointer-events-none"}`}
      >
          <button
            onClick={() => setSidebarOpen(false)}
            className="mx-auto mb-3 block h-1.5 w-14 rounded-full bg-white/95 shadow-sm transition hover:bg-white md:hidden"
            title="Close sidebar"
            aria-label="Close sidebar"
          />
          <div className="mb-5 rounded-3xl border border-white/50 bg-white/70 p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h1 className="bg-gradient-to-r from-pink-500 to-black bg-clip-text text-3xl font-black tracking-tight text-transparent">
                Route Studio
              </h1>

              <button
                onClick={() => setSidebarOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-lg font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50"
                title="Close sidebar"
                aria-label="Close sidebar"
              >
                X
              </button>
            </div>
            <p className="text-xs text-slate-500">Create, edit, and manage jeepney routes cleanly.</p>
          </div>

          <div className="space-y-3">
            {isBusRoute ? (
              <div className="rounded-3xl border border-slate-200 bg-white/75 p-4 shadow-sm">
                <label className="block text-sm font-semibold text-slate-700">Bus route code</label>
                <p className="mt-1 text-xs text-slate-500">
                  Use one code for both AM and PM, like r1346.
                </p>
                <input
                  value={busRouteCode}
                  onChange={(e) => setBusRouteCode(e.target.value)}
                  className="mt-3 w-full rounded-2xl border border-slate-200 bg-white/80 p-3 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#35B0AB] focus:ring-2 focus:ring-emerald-100"
                  placeholder="r1346"
                />
              </div>
            ) : (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-white/80 p-3 text-slate-900 shadow-sm outline-none transition focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
                placeholder={routeNamePlaceholder}
              />
            )}

            <input
              value={fare}
              onChange={(e) => setFare(e.target.value)}
              className={`w-full rounded-2xl border border-slate-200 bg-white/80 p-3 text-slate-900 shadow-sm outline-none transition focus:border-rose-300 focus:ring-2 focus:ring-rose-100 ${
                isBusRoute ? "hidden" : "block"
              }`}
              placeholder="Fare"
            />

            {isBusRoute && (
              <div className="rounded-3xl border border-slate-200 bg-white/75 p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700">Bus variants</label>
                  </div>
                  <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
                    {BUS_VARIANT_ORDER.map((variantKey) => {
                      const isSelected = activeBusVariant === variantKey;

                      return (
                        <button
                          key={variantKey}
                          type="button"
                          onClick={() => setActiveBusVariant(variantKey)}
                          className={`min-w-14 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                            isSelected
                              ? "bg-[#35B0AB] text-white shadow-sm"
                              : "text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {variantKey}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {BUS_VARIANT_ORDER.map((variantKey) => {
                    const variantDraft = busVariants[variantKey];
                    const isSelected = activeBusVariant === variantKey;

                    return (
                      <button
                        key={`${variantKey}-summary`}
                        type="button"
                        onClick={() => setActiveBusVariant(variantKey)}
                        className={`rounded-2xl border px-3 py-3 text-left transition ${
                          isSelected
                            ? "border-[#35B0AB] bg-[#35B0AB]/10 text-slate-900"
                            : "border-slate-200 bg-white text-slate-700 hover:border-[#35B0AB]/30 hover:bg-slate-50"
                        }`}
                      >
                        <div className="text-sm font-semibold">{variantKey} Route</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {variantDraft.stops.length} points ·{" "}
                          {variantDraft.schedule.trim() || "No schedule yet"}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-semibold text-slate-700">
                    {activeBusVariant} schedule
                  </label>
                  <input
                    value={activeBusDraft.schedule}
                    onChange={(e) =>
                      updateActiveBusVariant(activeBusVariant, (current) => ({
                        ...current,
                        schedule: e.target.value,
                      }))
                    }
                    className="mt-3 w-full rounded-2xl border border-slate-200 bg-white/80 p-3 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#35B0AB] focus:ring-2 focus:ring-emerald-100"
                    placeholder="6am - 10am"
                  />
                </div>

                <div className="mt-4">
                  <label className="block text-sm font-semibold text-slate-700">
                    Description
                  </label>
                  <textarea
                    value={busDescription}
                    onChange={(e) => setBusDescription(e.target.value)}
                    className="mt-3 min-h-24 w-full rounded-2xl border border-slate-200 bg-white/80 p-3 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-[#35B0AB] focus:ring-2 focus:ring-emerald-100"
                    placeholder="Optional bus description"
                  />
                </div>

              </div>
            )}

            {!isBusRoute && (
              <textarea
                value={routeDescription}
                onChange={(e) => setRouteDescription(e.target.value)}
                className="min-h-24 w-full rounded-2xl border border-slate-200 bg-white/80 p-3 text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
                placeholder={routeDescriptionPlaceholder}
              />
            )}

            <div className="rounded-3xl border border-slate-200 bg-white/75 p-3 shadow-sm">
              <div className="mb-2 text-sm font-semibold text-slate-700">Route line color</div>
              <div className="grid grid-cols-2 gap-2">
                {ROUTE_COLOR_OPTIONS.map((option) => {
                  const isSelected = routeColor === option.value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setRouteColor(option.value)}
                      className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-left text-sm font-medium transition ${
                        isSelected
                          ? "border-transparent bg-slate-900 text-white shadow-lg"
                          : "border-slate-200 bg-white text-slate-700 hover:border-rose-200 hover:bg-rose-50"
                      }`}
                    >
                      <span
                        className="h-5 w-5 rounded-full border border-white/80 shadow-sm"
                        style={{ backgroundColor: option.value }}
                        aria-hidden="true"
                      />
                      <span className="leading-tight">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white/75 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-slate-900">Add Stop Mode</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Enable this to mark the next clicks as stops. When disabled, clicks stay on
                    the polyline only.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsStopMode((current) => !current)}
                  className={`inline-flex min-w-24 items-center justify-center rounded-2xl px-3 py-2 text-sm font-semibold transition ${
                    isStopMode
                      ? "bg-emerald-500 text-white shadow-lg"
                      : "border border-slate-200 bg-white text-slate-700 hover:border-emerald-200 hover:bg-emerald-50"
                  }`}
                >
                  {isStopMode ? "Enabled" : "Disabled"}
                </button>
              </div>
            </div>

            <div className="text-sm font-medium text-slate-700">
              Points clicked: {activeStops.length}
              {isBusRoute ? ` for ${activeBusVariant}` : ""}
            </div>

            {activeStops.length > 0 && (
              <div className="rounded-3xl border border-slate-200 bg-white/75 p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-slate-900">Route Points</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Edit names, delete any point before saving, or drag the stop markers on the map.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={clearPath}
                    className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                  >
                    Clear All
                  </button>
                </div>

                <div className="mt-4 max-h-72 space-y-3 overflow-y-auto pr-1">
                  {activeStops.map((stop, index) => (
                    <div
                      key={stop.id}
                      className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1">
                          <label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                            {stop.is_stop
                              ? `${isBusRoute ? activeBusVariant : ""} Stop ${index + 1}`.trim()
                              : `${isBusRoute ? activeBusVariant : ""} Point ${index + 1}`.trim()}
                          </label>
                          <input
                            value={stop.name}
                            onChange={(event) => updateStopName(stop.id, event.target.value)}
                            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
                            placeholder={
                              stop.is_stop
                                ? `${isBusRoute ? activeBusVariant : ""} Stop ${index + 1}`.trim()
                                : `${isBusRoute ? activeBusVariant : ""} Point ${index + 1}`.trim()
                            }
                          />
                          <p className="mt-2 text-[11px] text-slate-500">
                            {stop.lat.toFixed(6)}, {stop.lng.toFixed(6)}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeStop(stop.id)}
                          className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={undoPoint}
              className="w-full rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-white"
            >
              Undo Last Point
            </button>

            <button
              onClick={clearPath}
              className="w-full rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 font-medium text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-white"
            >
              Clear Path
            </button>

            <button
              onClick={saveRoute}
              disabled={isSavingRoute || isFetchingRoutes}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-fuchsia-600 via-rose-600 to-indigo-600 px-4 py-3 font-semibold text-white shadow-lg transition duration-200 hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSavingRoute ? (
                <>
                  <Spinner />
                  <span>Saving...</span>
                </>
              ) : (
                isBusRoute ? "Save AM & PM Routes" : "Save Route"
              )}
            </button>

            <div className="mt-6 border-t pt-4">
              <h2 className="mb-3 font-bold text-slate-800">Delete Jeepney Route</h2>
              <button
                onClick={() => setDeleteModalOpen(true)}
                disabled={isFetchingRoutes || deletingRouteId !== null}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500 to-pink-600 px-4 py-3 font-semibold text-white shadow-lg transition duration-200 hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-70"
              >
                {deletingRouteId !== null ? (
                  <>
                    <Spinner />
                    <span>Deleting...</span>
                  </>
                ) : (
                  "Delete Jeepney Routes"
                )}
              </button>
            </div>

            {isFetchingRoutes && (
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <Spinner className="h-3.5 w-3.5" />
                <span>Loading routes...</span>
              </div>
            )}

            {message && <p className="text-sm text-slate-700">{message}</p>}
          </div>
      </aside>

      <section className="relative h-full min-w-0 flex-1">
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute bottom-6 left-4 z-[1300] inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/60 bg-white/90 text-slate-800 shadow-xl backdrop-blur transition hover:-translate-y-0.5 hover:bg-white md:bottom-auto md:left-6 md:top-6"
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <span className="inline-block h-3 w-4">
              <span className="mb-1 block h-[2px] w-4 rounded bg-slate-700" />
              <span className="mb-1 block h-[2px] w-4 rounded bg-slate-700" />
              <span className="block h-[2px] w-4 rounded bg-slate-700" />
            </span>
          </button>
        )}

        <MapContainer
          center={[7.0707, 125.6123]}
          zoom={14}
          scrollWheelZoom={true}
          zoomControl={false}
          className="h-full w-full"
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ZoomControl position="bottomright" />

          <ClickHandler onAddPoint={addPoint} isStopMode={isStopMode} />

          {displayPath.length > 0 && (
            <>
              <Polyline
                positions={displayPath.map((point) => [point.lat, point.lng])}
                pathOptions={{
                  color: selectedRouteColor,
                  weight: 10,
                  opacity: 0.22,
                  lineJoin: "round",
                  lineCap: "round",
                }}
              />
              <Polyline
                positions={displayPath.map((point) => [point.lat, point.lng])}
                pathOptions={{
                  color: selectedRouteColor,
                  weight: 6,
                  opacity: 0.98,
                  lineJoin: "round",
                  lineCap: "round",
                }}
              />
            </>
          )}

              {activeStops
                .filter((stop) => stop.is_stop)
                .map((stop, index) => (
              <Marker
                key={stop.id}
                position={[stop.lat, stop.lng]}
                draggable
                icon={createStopIcon(selectedRouteColor, String(index + 1))}
                eventHandlers={{
                  dragend: (event) => {
                    const marker = event.target as L.Marker;
                    const nextPosition = marker.getLatLng();
                    updateStopPosition(stop.id, nextPosition.lat, nextPosition.lng);
                  },
                }}
              >
                <Popup>
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-slate-900">
                      {stop.name || `Stop ${index + 1}`}
                    </div>
                    <div className="text-xs text-slate-500">
                      {stop.lat.toFixed(6)}, {stop.lng.toFixed(6)}
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
        </MapContainer>

        <div className="pointer-events-none absolute bottom-3 left-1/2 z-[900] -translate-x-1/2 px-3 py-1 text-center text-[11px] font-medium leading-tight text-black/70">
          <span className="block">@DavCom Guide 2026</span>
          <span className="block">Lawrence Jay Saludes</span>
        </div>
      </section>

      {deleteModalOpen && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-white/60 bg-white/95 p-5 shadow-2xl backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="bg-gradient-to-r from-rose-600 to-fuchsia-600 bg-clip-text text-xl font-black text-transparent">
                Delete Jeepney Routes
              </h2>
              <button
                onClick={() => setDeleteModalOpen(false)}
                disabled={deletingRouteId !== null}
                className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-200 text-slate-700 transition hover:bg-slate-50"
                aria-label="Close delete modal"
              >
                X
              </button>
            </div>

            <input
              value={deleteSearch}
              onChange={(e) => setDeleteSearch(e.target.value)}
              disabled={deletingRouteId !== null}
              className="mb-4 w-full rounded-2xl border border-slate-200 bg-white p-3 text-slate-900 shadow-sm outline-none transition focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
              placeholder="Search jeepney route..."
            />

            <div className="space-y-2">
              {filteredRoutes.length > 0 ? (
                filteredRoutes.map((route) => (
                  <div
                    key={route.id}
                    className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
                  >
                    <span className="font-medium text-slate-800">{route.name}</span>
                    <button
                      onClick={() => deleteRoute(route.id)}
                      disabled={deletingRouteId !== null}
                      className="inline-flex min-w-[5.8rem] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-rose-500 to-pink-600 px-3 py-1 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {deletingRouteId === route.id ? (
                        <>
                          <Spinner className="h-3.5 w-3.5" />
                          <span>Deleting...</span>
                        </>
                      ) : (
                        "Delete"
                      )}
                    </button>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 p-3 text-slate-600">
                  No routes found.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>

      {!isUnlocked && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/60 bg-white/95 p-6 shadow-2xl">
            <h2 className="mb-2 bg-gradient-to-r from-rose-600 to-fuchsia-600 bg-clip-text text-2xl font-black text-transparent">
              Admin Login
            </h2>
            <p className="mb-4 text-sm text-slate-600">
              Enter your admin password to continue.
            </p>

            <form className="space-y-3" onSubmit={unlockAdmin}>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                disabled={isCheckingAuth}
                className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-slate-900 shadow-sm outline-none transition focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
                placeholder="Admin password"
                autoFocus
              />
              <button
                type="submit"
                disabled={isCheckingAuth}
className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-pink-500 to-green-500 px-4 py-3 font-semibold text-white shadow-lg transition duration-200 hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isCheckingAuth ? (
                  <>
                    <Spinner />
                    <span>Checking...</span>
                  </>
                ) : (
                  "Unlock Admin"
                )}
              </button>
            </form>

            {authError && <p className="mt-3 text-sm font-medium text-rose-600">{authError}</p>}
          </div>
        </div>
      )}
    </main>
  );
}
