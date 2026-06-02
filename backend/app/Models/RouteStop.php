<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RouteStop extends Model
{
    protected $fillable = [
        'commute_route_id',
        'name',
        'latitude',
        'longitude',
        'order_index',
        'is_stop',
    ];

    public function route()
    {
        return $this->belongsTo(CommuteRoute::class, 'commute_route_id');
    }
}
