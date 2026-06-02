<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CommuteRoute extends Model
{
    protected $fillable = [
        'route_code',
        'name',
        'start_point',
        'end_point',
        'base_fare',
        'description',
        'route_description',
        'schedule',
        'service_period',
        'route_color',
        'polyline_color',
    ];

    public function stops()
    {
        return $this->hasMany(RouteStop::class)->orderBy('order_index');
    }
}
