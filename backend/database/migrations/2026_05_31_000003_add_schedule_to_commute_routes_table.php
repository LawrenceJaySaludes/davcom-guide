<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (! Schema::hasColumn('commute_routes', 'schedule')) {
            Schema::table('commute_routes', function (Blueprint $table) {
                $table->string('schedule', 255)->nullable()->after('route_description');
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasColumn('commute_routes', 'schedule')) {
            Schema::table('commute_routes', function (Blueprint $table) {
                $table->dropColumn('schedule');
            });
        }
    }
};
