#!/bin/sh
set -eu

echo "=== Render Start Script ==="
echo "PORT=${PORT}"

cd /var/www

# Ensure all Laravel runtime directories exist
echo "=== Creating Laravel directories ==="
mkdir -p storage/framework/cache/data
mkdir -p storage/framework/sessions
mkdir -p storage/framework/views
mkdir -p storage/framework/testing
mkdir -p storage/logs
mkdir -p storage/app/public
mkdir -p bootstrap/cache

# Fix ownership for www-data (PHP-FPM user)
echo "=== Fixing ownership ==="
chown -R www-data:www-data storage bootstrap/cache

# Fix permissions
chmod -R 775 storage bootstrap/cache

# Remove default nginx configs
rm -f /etc/nginx/sites-enabled/*
mkdir -p /etc/nginx/conf.d

# Generate nginx config with Render $PORT
sed "s/PORT_PLACEHOLDER/${PORT}/g" /var/www/docker/nginx-railway.conf > /etc/nginx/conf.d/default.conf

# Validate configs
echo "=== PHP-FPM config check ==="
php-fpm -t

echo "=== Nginx config check ==="
nginx -t

# Run database migrations
echo "=== Running migrations ==="
php artisan migrate --force

# Run Laravel production cache commands
echo "=== Caching Laravel config ==="
php artisan config:cache
php artisan route:cache || true
php artisan view:cache || true

# Start PHP-FPM in background
echo "=== Starting PHP-FPM ==="
php-fpm -D

echo "=== Nginx config ==="
cat /etc/nginx/conf.d/default.conf

# Start Nginx in foreground
echo "=== Starting Nginx on port ${PORT} ==="
exec nginx -g "daemon off;"
