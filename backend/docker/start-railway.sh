#!/bin/sh
set -eu

echo "=== Railway Start Script ==="
echo "PORT=${PORT}"

# Remove default nginx site config that may conflict with $PORT
rm -f /etc/nginx/sites-enabled/default

# Ensure nginx conf.d exists
mkdir -p /etc/nginx/conf.d

# Generate final nginx config with Railway $PORT
sed "s/PORT_PLACEHOLDER/${PORT}/g" /var/www/docker/nginx-railway.conf > /etc/nginx/conf.d/default.conf

# Validate configs
echo "=== PHP-FPM config check ==="
php-fpm -t

echo "=== Nginx config check ==="
nginx -t

# Start PHP-FPM in background
echo "=== Starting PHP-FPM ==="
php-fpm -D

# Start Nginx in foreground
echo "=== Starting Nginx on port ${PORT} ==="
exec nginx -g 'daemon off;'
