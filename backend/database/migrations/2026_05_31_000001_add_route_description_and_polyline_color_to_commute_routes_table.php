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
        Schema::table('commute_routes', function (Blueprint $table) {
            $table->text('route_description')->nullable()->after('description');
            $table->string('polyline_color', 16)->nullable()->after('route_description');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('commute_routes', function (Blueprint $table) {
            $table->dropColumn(['route_description', 'polyline_color']);
        });
    }
};
