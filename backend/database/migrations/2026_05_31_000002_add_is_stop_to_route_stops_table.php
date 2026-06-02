<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (! Schema::hasColumn('route_stops', 'is_stop')) {
            Schema::table('route_stops', function (Blueprint $table) {
                $table->boolean('is_stop')->default(false)->after('order_index');
            });
        }

        if (Schema::hasColumn('route_stops', 'is_stop')) {
            DB::table('route_stops')
                ->where(function ($query) {
                    $query->where('name', 'like', 'Stop %')
                        ->orWhere('name', 'like', '% Start');
                })
                ->update(['is_stop' => true]);
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasColumn('route_stops', 'is_stop')) {
            Schema::table('route_stops', function (Blueprint $table) {
                $table->dropColumn('is_stop');
            });
        }
    }
};
