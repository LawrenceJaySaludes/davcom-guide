<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\CommuteRouteController;
use App\Http\Controllers\PlaceSearchController;
use App\Http\Controllers\RouteStopController;

Route::get('/health', function () {
    return response()->json([
        'app' => 'DavCom Guide API',
        'status' => 'running',
        'message' => 'Backend is working successfully'
    ]);
});

Route::get('/places/search', [PlaceSearchController::class, 'search']);
Route::get('/routes/nearby', [CommuteRouteController::class, 'nearby']);
Route::apiResource('routes', CommuteRouteController::class)->only(['index', 'show']);
Route::apiResource('stops', RouteStopController::class)->only(['index', 'show']);

Route::middleware('admin.key')->group(function () {
    Route::get('/admin/verify', fn () => response()->json(['message' => 'Admin key valid.']));
    Route::get('/admin/routes-list', [CommuteRouteController::class, 'adminList']);
    Route::apiResource('routes', CommuteRouteController::class)->except(['index', 'show']);
    Route::apiResource('stops', RouteStopController::class)->except(['index', 'show']);
    Route::post('/admin/routes-with-path', [CommuteRouteController::class, 'storeWithPath']);
    Route::post('/admin/bus-routes-with-paths', [CommuteRouteController::class, 'storeBusWithPaths']);
});
