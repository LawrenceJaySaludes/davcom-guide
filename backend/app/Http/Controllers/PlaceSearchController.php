<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Throwable;

class PlaceSearchController extends Controller
{
    private const DAVAO_VIEWBOX = [
        125.30, // west
        7.45,   // north
        125.85, // east
        6.75,   // south
    ];

    public function search(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'query' => 'sometimes|required_without:q|string|min:2|max:120',
            'q' => 'sometimes|required_without:query|string|min:2|max:120',
            'limit' => 'sometimes|integer|min:1|max:10',
        ]);

        $query = trim((string) ($validated['query'] ?? $validated['q'] ?? ''));
        $limit = (int) ($validated['limit'] ?? 6);

        if ($query === '') {
            return response()->json([
                'query' => '',
                'suggestions' => [],
                'source' => 'nominatim',
            ]);
        }

        $cacheKey = 'place-search:' . md5(mb_strtolower($query) . ':' . $limit);

        try {
            $payload = Cache::store('file')->remember(
                $cacheKey,
                now()->addMinutes(30),
                function () use ($query, $limit) {
                    return $this->fetchSuggestions($query, $limit);
                }
            );
        } catch (Throwable $exception) {
            if ($exception instanceof HttpException) {
                $statusCode = $exception->getStatusCode();
            } else {
                report($exception);
                $statusCode = 502;
            }

            return response()->json([
                'message' => $exception->getMessage() ?: 'Unable to load place suggestions right now.',
                'query' => $query,
                'suggestions' => [],
                'source' => 'nominatim',
            ], $statusCode);
        }

        return response()->json($payload);
    }

    private function fetchSuggestions(string $query, int $limit): array
    {
        $baseUrl = rtrim((string) config('services.nominatim.base_url', 'https://nominatim.openstreetmap.org'), '/');
        $userAgent = (string) config('services.nominatim.user_agent', 'DavCom Guide/1.0');
        $email = trim((string) config('services.nominatim.email', ''));

        $response = Http::connectTimeout(2)
            ->timeout(6)
            ->withHeaders([
                'User-Agent' => $userAgent,
                'Referer' => config('app.url', url('/')),
            ])
            ->acceptJson()
            ->get($baseUrl . '/search', array_filter([
                'q' => $query,
                'format' => 'geocodejson',
                'limit' => $limit,
                'countrycodes' => 'ph',
                'viewbox' => implode(',', self::DAVAO_VIEWBOX),
                'bounded' => 1,
                'addressdetails' => 1,
                'dedupe' => 1,
                'accept-language' => 'en',
                'email' => $email !== '' ? $email : null,
            ], static fn ($value) => $value !== null && $value !== ''));

        if (! $response->successful()) {
            throw new HttpException(502, 'Unable to load place suggestions right now.');
        }

        $body = $response->json();
        $features = is_array($body['features'] ?? null) ? $body['features'] : [];
        $suggestions = [];

        foreach ($features as $feature) {
            $coordinates = $feature['geometry']['coordinates'] ?? null;
            $geocoding = $feature['properties']['geocoding'] ?? [];

            if (! is_array($coordinates) || count($coordinates) < 2) {
                continue;
            }

            $longitude = (float) $coordinates[0];
            $latitude = (float) $coordinates[1];
            $label = (string) ($geocoding['label'] ?? $geocoding['name'] ?? '');

            if ($label === '') {
                continue;
            }

            if (! $this->isWithinDavaoBounds($latitude, $longitude)) {
                continue;
            }

            $suggestions[] = [
                'name' => (string) ($geocoding['name'] ?? $label),
                'label' => $label,
                'type' => (string) ($geocoding['type'] ?? ''),
                'latitude' => $latitude,
                'longitude' => $longitude,
            ];
        }

        return [
            'query' => $query,
            'suggestions' => $suggestions,
            'source' => 'nominatim',
        ];
    }

    private function isWithinDavaoBounds(float $latitude, float $longitude): bool
    {
        [$west, $north, $east, $south] = self::DAVAO_VIEWBOX;

        return $longitude >= $west
            && $longitude <= $east
            && $latitude <= $north
            && $latitude >= $south;
    }
}
