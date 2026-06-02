<?php

namespace App\Http\Controllers;

use App\Models\CommuteRoute;
use App\Models\RouteStop;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class CommuteRouteController extends Controller
{
    public function nearby(Request $request)
    {
        $validated = $request->validate([
            'lat' => 'required|numeric|between:-90,90',
            'lng' => 'required|numeric|between:-180,180',
            'radius' => 'sometimes|numeric|min:50|max:' . (int) config('commute.nearby_jeepneys.max_radius_meters', 5000),
        ]);

        $latitude = (float) $validated['lat'];
        $longitude = (float) $validated['lng'];
        $radiusMeters = (float) ($validated['radius'] ?? config('commute.nearby_jeepneys.default_radius_meters', 500));
        $radiusMeters = max(50, min($radiusMeters, (float) config('commute.nearby_jeepneys.max_radius_meters', 5000)));

        $earthRadiusMeters = 6371000;
        $latitudeDelta = rad2deg($radiusMeters / $earthRadiusMeters);
        $longitudeDelta = rad2deg(
            $radiusMeters / ($earthRadiusMeters * max(cos(deg2rad($latitude)), 0.000001))
        );

        $minLatitude = $latitude - $latitudeDelta;
        $maxLatitude = $latitude + $latitudeDelta;
        $minLongitude = $longitude - $longitudeDelta;
        $maxLongitude = $longitude + $longitudeDelta;

        $distanceSql = <<<SQL
6371000 * acos(least(1, greatest(-1,
    cos(radians(?)) * cos(radians(route_stops.latitude)) *
    cos(radians(route_stops.longitude) - radians(?)) +
    sin(radians(?)) * sin(radians(route_stops.latitude))
)))
SQL;

        $rows = DB::table('route_stops')
            ->join('commute_routes', 'commute_routes.id', '=', 'route_stops.commute_route_id')
            ->whereBetween('route_stops.latitude', [$minLatitude, $maxLatitude])
            ->whereBetween('route_stops.longitude', [$minLongitude, $maxLongitude])
            ->whereRaw("($distanceSql) <= ?", [$latitude, $longitude, $latitude, $radiusMeters])
            ->select([
                'commute_routes.id as route_id',
                'commute_routes.name as route_name',
                'commute_routes.route_code as route_code',
                'commute_routes.route_color as route_color',
                'commute_routes.polyline_color as polyline_color',
                'commute_routes.start_point',
                'commute_routes.end_point',
                'commute_routes.description',
                'commute_routes.route_description',
                'commute_routes.schedule',
                'commute_routes.service_period',
                'route_stops.id as stop_id',
                'route_stops.name as stop_name',
                'route_stops.latitude as stop_latitude',
                'route_stops.longitude as stop_longitude',
                'route_stops.order_index as stop_order_index',
            ])
            ->selectRaw("($distanceSql) as distance_meters", [$latitude, $longitude, $latitude])
            ->orderBy('distance_meters')
            ->orderBy('commute_routes.id')
            ->get();

        $routes = [];

        foreach ($rows as $row) {
            $routeId = (int) $row->route_id;

            if (! isset($routes[$routeId])) {
                $routeCode = $row->route_code;

                if (! is_string($routeCode) || trim($routeCode) === '') {
                    $routeCode = $this->deriveRouteCode((string) $row->route_name);
                }

                $routes[$routeId] = [
                    'route_id' => $routeId,
                    'route_name' => $row->route_name,
                    'route_code' => $routeCode,
                    'route_color' => $row->route_color,
                    'polyline_color' => $row->polyline_color ?? $row->route_color,
                    'start_point' => $row->start_point,
                    'end_point' => $row->end_point,
                    'description' => $row->description,
                    'route_description' => $row->route_description ?? $row->description,
                    'schedule' => $row->schedule,
                    'service_period' => $row->service_period,
                    'nearest_stop' => [
                        'id' => (int) $row->stop_id,
                        'name' => $row->stop_name,
                        'latitude' => (float) $row->stop_latitude,
                        'longitude' => (float) $row->stop_longitude,
                        'order_index' => (int) $row->stop_order_index,
                        'distance_meters' => (float) $row->distance_meters,
                    ],
                    'distance_meters' => (float) $row->distance_meters,
                    'nearby_stop_count' => 0,
                    'nearby_stops' => [],
                ];
            }

            $routes[$routeId]['nearby_stop_count']++;
            $routes[$routeId]['nearby_stops'][] = [
                'id' => (int) $row->stop_id,
                'name' => $row->stop_name,
                'latitude' => (float) $row->stop_latitude,
                'longitude' => (float) $row->stop_longitude,
                'order_index' => (int) $row->stop_order_index,
                'distance_meters' => (float) $row->distance_meters,
            ];
        }

        return response()->json([
            'location' => [
                'lat' => $latitude,
                'lng' => $longitude,
            ],
            'radius_meters' => $radiusMeters,
            'routes' => array_values($routes),
        ]);
    }

    public function adminList()
    {
        return CommuteRoute::query()
            ->select(['id', 'name'])
            ->orderByRaw('LOWER(name)')
            ->get();
    }

    public function index()
    {
        return CommuteRoute::with('stops')->orderByRaw('LOWER(name)')->get();
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'route_code' => 'nullable|string|max:255',
            'name' => 'required|string|max:255',
            'start_point' => 'required|string|max:255',
            'end_point' => 'required|string|max:255',
            'base_fare' => 'nullable|numeric|min:0',
            'description' => 'nullable|string',
            'route_description' => 'nullable|string',
            'schedule' => 'nullable|string|max:255',
            'service_period' => 'nullable|string|in:AM,PM',
            'route_color' => 'nullable|string|in:#db2777,#35B0AB',
            'polyline_color' => 'nullable|string|in:#db2777,#35B0AB',
        ]);

        $payload = $validated;
        $payload['route_description'] = $validated['route_description'] ?? $validated['description'] ?? null;
        $payload['description'] = $payload['route_description'];
        $payload['schedule'] = $validated['schedule'] ?? null;
        $payload['service_period'] = $validated['service_period'] ?? null;
        $payload['polyline_color'] = $validated['polyline_color'] ?? $validated['route_color'] ?? null;
        $payload['route_color'] = $payload['polyline_color'];
        $payload['route_code'] = $validated['route_code'] ?? null;

        return CommuteRoute::create($payload);
    }

    public function storeWithPath(Request $request)
    {
        $validated = $request->validate([
            'route_code' => 'nullable|string|max:255',
            'name' => 'required|string|max:255',
            'start_point' => 'nullable|string|max:255',
            'end_point' => 'nullable|string|max:255',
            'base_fare' => 'required|numeric|min:0',
            'description' => 'nullable|string',
            'route_description' => 'nullable|string',
            'schedule' => 'nullable|string|max:255',
            'service_period' => 'nullable|string|in:AM,PM',
            'route_color' => 'nullable|string|in:#db2777,#35B0AB',
            'polyline_color' => 'nullable|string|in:#db2777,#35B0AB',
            'path' => 'required|array|min:2',
            'path.*.lat' => 'required|numeric',
            'path.*.lng' => 'required|numeric',
            'stops' => 'sometimes|array',
            'stops.*.name' => 'sometimes|nullable|string|max:255',
            'stops.*.stop_name' => 'sometimes|nullable|string|max:255',
            'stops.*.lat' => 'sometimes|nullable|numeric',
            'stops.*.lng' => 'sometimes|nullable|numeric',
            'stops.*.is_stop' => 'sometimes|boolean',
        ]);

        $route = DB::transaction(function () use ($validated) {
            return $this->persistRouteWithPath($validated, $validated['path'], $validated['stops'] ?? []);
        });

        return response()->json($route->only(['id', 'name']), 201);
    }

    public function storeBusWithPaths(Request $request)
    {
        $validated = $request->validate([
            'route_code' => 'required|string|max:255',
            'base_fare' => 'required|numeric|min:0',
            'route_color' => 'nullable|string|in:#db2777,#35B0AB',
            'polyline_color' => 'nullable|string|in:#db2777,#35B0AB',
            'description' => 'nullable|string',
            'route_description' => 'nullable|string',
            'variants' => 'required|array|min:2',
            'variants.*.service_period' => 'required|string|in:AM,PM',
            'variants.*.schedule' => 'nullable|string|max:255',
            'variants.*.description' => 'nullable|string',
            'variants.*.route_description' => 'nullable|string',
            'variants.*.path' => 'required|array|min:2',
            'variants.*.path.*.lat' => 'required|numeric',
            'variants.*.path.*.lng' => 'required|numeric',
            'variants.*.stops' => 'sometimes|array',
            'variants.*.stops.*.name' => 'sometimes|nullable|string|max:255',
            'variants.*.stops.*.stop_name' => 'sometimes|nullable|string|max:255',
            'variants.*.stops.*.lat' => 'sometimes|nullable|numeric',
            'variants.*.stops.*.lng' => 'sometimes|nullable|numeric',
            'variants.*.stops.*.is_stop' => 'sometimes|boolean',
        ]);

        $routes = DB::transaction(function () use ($validated) {
            $createdRoutes = [];
            $sharedDescription = $validated['route_description'] ?? $validated['description'] ?? null;
            $polylineColor = $validated['polyline_color'] ?? $validated['route_color'] ?? null;

            foreach ($validated['variants'] as $variant) {
                $servicePeriod = strtoupper(trim((string) $variant['service_period']));
                $routeName = trim($validated['route_code']) . ' ' . $servicePeriod;
                $routePayload = [
                    'route_code' => trim($validated['route_code']),
                    'name' => $routeName,
                    'start_point' => $variant['start_point'] ?? null,
                    'end_point' => $variant['end_point'] ?? null,
                    'base_fare' => $validated['base_fare'],
                    'description' => $variant['route_description'] ?? $variant['description'] ?? $sharedDescription,
                    'route_description' => $variant['route_description'] ?? $variant['description'] ?? $sharedDescription,
                    'schedule' => $variant['schedule'] ?? null,
                    'service_period' => $servicePeriod,
                    'route_color' => $polylineColor,
                    'polyline_color' => $polylineColor,
                ];

                $createdRoutes[] = $this->persistRouteWithPath(
                    $routePayload,
                    $variant['path'],
                    $variant['stops'] ?? []
                );
            }

            return $createdRoutes;
        });

        return response()->json([
            'routes' => array_map(
                fn (CommuteRoute $route) => $route->only(['id', 'name']),
                $routes
            ),
        ], 201);
    }

    public function show(CommuteRoute $route)
    {
        return $route->load('stops');
    }

    public function update(Request $request, CommuteRoute $route)
    {
        $validated = $request->validate([
            'route_code' => 'nullable|string|max:255',
            'name' => 'sometimes|required|string|max:255',
            'start_point' => 'sometimes|required|string|max:255',
            'end_point' => 'sometimes|required|string|max:255',
            'base_fare' => 'nullable|numeric|min:0',
            'description' => 'nullable|string',
            'route_description' => 'nullable|string',
            'schedule' => 'nullable|string|max:255',
            'service_period' => 'nullable|string|in:AM,PM',
            'route_color' => 'nullable|string|in:#db2777,#35B0AB',
            'polyline_color' => 'nullable|string|in:#db2777,#35B0AB',
        ]);

        $payload = $validated;
        $payload['route_description'] = $validated['route_description'] ?? $validated['description'] ?? null;
        $payload['description'] = $payload['route_description'];
        $payload['schedule'] = $validated['schedule'] ?? null;
        $payload['service_period'] = $validated['service_period'] ?? null;
        $payload['polyline_color'] = $validated['polyline_color'] ?? $validated['route_color'] ?? null;
        $payload['route_color'] = $payload['polyline_color'];
        $payload['route_code'] = $validated['route_code'] ?? null;

        $route->update($payload);

        return $route->load('stops');
    }

    public function destroy($routeId)
    {
        $route = CommuteRoute::find($routeId);

        if (!$route) {
            return response()->json([
                'message' => 'Route already deleted.',
            ]);
        }

        $route->delete();

        return response()->json([
            'message' => 'Route deleted successfully',
        ]);
    }

    private function deriveRouteCode(string $routeName): string
    {
        $routeCode = trim((string) preg_replace('/^route\s+/i', '', $routeName));

        return $routeCode !== '' ? $routeCode : $routeName;
    }

    private function persistRouteWithPath(array $routeData, array $path, array $validatedStops = []): CommuteRoute
    {
        $firstPoint = $path[0];
        $lastPoint = $path[count($path) - 1];
        $fallbackStart = sprintf('%.6f, %.6f', $firstPoint['lat'], $firstPoint['lng']);
        $fallbackEnd = sprintf('%.6f, %.6f', $lastPoint['lat'], $lastPoint['lng']);

        $route = CommuteRoute::create([
            'route_code' => $routeData['route_code'] ?? null,
            'name' => $routeData['name'],
            'start_point' => $routeData['start_point'] ?? $fallbackStart,
            'end_point' => $routeData['end_point'] ?? $fallbackEnd,
            'base_fare' => $routeData['base_fare'],
            'description' => $routeData['description'] ?? null,
            'route_description' => $routeData['route_description'] ?? null,
            'schedule' => $routeData['schedule'] ?? null,
            'service_period' => $routeData['service_period'] ?? null,
            'route_color' => $routeData['route_color'] ?? null,
            'polyline_color' => $routeData['polyline_color'] ?? null,
        ]);

        $now = now();
        $rows = [];

        foreach ($path as $index => $point) {
            $stopInput = $validatedStops[$index] ?? [];
            $stopName = $stopInput['name'] ?? null;
            $stopName = $stopName ?? ($stopInput['stop_name'] ?? null);
            $stopName = is_string($stopName) ? trim($stopName) : '';
            $isStop = (bool) ($stopInput['is_stop'] ?? false);
            $fallbackName = $isStop ? 'Stop ' . ($index + 1) : 'Point ' . ($index + 1);

            $rows[] = [
                'commute_route_id' => $route->id,
                'name' => $stopName !== '' ? $stopName : $fallbackName,
                'latitude' => $point['lat'],
                'longitude' => $point['lng'],
                'order_index' => $index + 1,
                'is_stop' => $isStop,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        RouteStop::insert($rows);

        return $route;
    }
}
