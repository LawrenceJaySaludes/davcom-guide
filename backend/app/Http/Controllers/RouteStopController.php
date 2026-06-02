<?php

namespace App\Http\Controllers;

use App\Models\RouteStop;
use Illuminate\Http\Request;

class RouteStopController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index()
    {
         return RouteStop::orderBy('order_index')->get();
    }

    /**
     * Show the form for creating a new resource.
     */
    public function create()
    {
        //
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'commute_route_id' => 'required|exists:commute_routes,id',
            'name' => 'required|string|max:255',
            'latitude' => 'required|numeric',
            'longitude' => 'required|numeric',
            'order_index' => 'nullable|integer',
            'is_stop' => 'nullable|boolean',
        ]);

        return RouteStop::create($validated);
    }

    /**
     * Display the specified resource.
     */
    public function show(RouteStop $routeStop)
    {
        return $routeStop;
    }

    /**
     * Show the form for editing the specified resource.
     */
    public function edit(RouteStop $routeStop)
    {
        //
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, RouteStop $routeStop)
    {
        $validated = $request->validate([
            'commute_route_id' => 'sometimes|required|exists:commute_routes,id',
            'name' => 'sometimes|required|string|max:255',
            'latitude' => 'sometimes|required|numeric',
            'longitude' => 'sometimes|required|numeric',
            'order_index' => 'nullable|integer',
            'is_stop' => 'nullable|boolean',
        ]);

        $routeStop->update($validated);

        return $routeStop;
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(RouteStop $routeStop)
    {
        $routeStop->delete();

        return response()->json([
            'message' => 'Stop deleted successfully',
        ]);
    }
}
