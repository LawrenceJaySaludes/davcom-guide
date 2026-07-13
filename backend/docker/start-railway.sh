#!/bin/sh
set -eu

echo "=== Railway Start Script ==="
echo "PORT=${PORT}"

# Remove all default nginx site configs that may conflict with $PORT
rm -f /etc/nginx/sites-enabled/*

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

echo "=== Nginx binary ==="
command -v nginx

echo "=== Final Nginx config ==="
cat /etc/nginx/conf.d/default.conf

echo "=== Listening ports before nginx ==="
ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null || true

# Start Nginx in foreground
echo "=== Starting Nginx on port ${PORT} ==="
echo "Fixing Laravel permissions..."

chmod -R 775 /var/www/storage
chmod -R 775 /var/www/bootstrap/cache

exec nginx -g "daemon off;"
