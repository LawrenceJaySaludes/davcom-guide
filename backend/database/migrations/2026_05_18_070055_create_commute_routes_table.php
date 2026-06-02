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
        Schema::create('commute_routes', function (Blueprint $table) {
    $table->id();
    $table->string('name');
    $table->string('route_code')->nullable();
    $table->string('start_point');
    $table->string('end_point');
    $table->decimal('base_fare', 8, 2)->default(13.00);
    $table->text('description')->nullable();
    $table->timestamps();
});
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('commute_routes');
    }
};
