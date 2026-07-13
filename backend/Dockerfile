FROM php:8.4-fpm

ARG CACHE_BUST=20260603_1

WORKDIR /var/www

RUN apt-get update && apt-get install -y \
    zip unzip git libpq-dev nginx \
    && docker-php-ext-install pdo pdo_pgsql \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer

COPY . .
RUN composer install --no-interaction --prefer-dist

COPY docker/start-container.sh /usr/local/bin/start-container
COPY docker/start-railway.sh /usr/local/bin/start-railway
COPY docker/nginx-railway.conf /var/www/docker/nginx-railway.conf
RUN chmod +x /usr/local/bin/start-container /usr/local/bin/start-railway

ENV PORT=80

EXPOSE 80 9000

CMD ["/usr/local/bin/start-railway"]
