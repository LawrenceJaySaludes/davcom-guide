<?php

return [
    'nearby_jeepneys' => [
        'default_radius_meters' => env('NEARBY_JEEPNEY_RADIUS_METERS', 500),
        'max_radius_meters' => env('NEARBY_JEEPNEY_MAX_RADIUS_METERS', 5000),
    ],
];
