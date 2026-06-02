#!/bin/sh
set -eu

cd /var/www

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
fi

if [ ! -f vendor/autoload.php ]; then
  composer install --no-interaction --prefer-dist
fi

until php artisan migrate --force; do
  echo "Waiting for database..."
  sleep 2
done

exec php-fpm -F
