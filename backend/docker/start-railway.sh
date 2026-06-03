#!/bin/sh
set -eu

# Replace PORT placeholder with Railway's $PORT env var
sed "s/PORT_PLACEHOLDER/${PORT}/g" /var/www/docker/nginx-railway.conf > /etc/nginx/conf.d/default.conf

# Start PHP-FPM in background
php-fpm -D

# Start Nginx in foreground
exec nginx -g 'daemon off;'
