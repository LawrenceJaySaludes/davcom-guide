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
        if (! Schema::hasColumn('commute_routes', 'service_period')) {
            Schema::table('commute_routes', function (Blueprint $table) {
                $table->string('service_period', 16)->nullable()->after('schedule');
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasColumn('commute_routes', 'service_period')) {
            Schema::table('commute_routes', function (Blueprint $table) {
                $table->dropColumn('service_period');
            });
        }
    }
};
