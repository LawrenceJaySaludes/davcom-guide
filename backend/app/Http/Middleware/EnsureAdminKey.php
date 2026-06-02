<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureAdminKey
{
    public function handle(Request $request, Closure $next): Response
    {
        $expectedKey = (string) config('admin.api_key');

        if ($expectedKey === '') {
            return response()->json([
                'message' => 'Admin access is not configured.',
            ], Response::HTTP_FORBIDDEN);
        }

        $providedKey = (string) $request->header('X-Admin-Key', '');

        if (! hash_equals($expectedKey, $providedKey)) {
            return response()->json([
                'message' => 'Unauthorized admin key.',
            ], Response::HTTP_UNAUTHORIZED);
        }

        return $next($request);
    }
}
