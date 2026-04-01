#!/bin/sh
set -e

SSL_DIR="/etc/nginx/ssl"
SSL_CERT="$SSL_DIR/cert.pem"
SSL_FULLCHAIN="$SSL_DIR/fullchain.pem"
SSL_KEY="$SSL_DIR/key.pem"
DEFAULT_CONF="/etc/nginx/conf.d/default.conf"
HTTPS_CONF="/etc/nginx/conf.d/https.conf"
CATCHALL_CONF="/etc/nginx/conf.d/catch-all.conf"
LOCATIONS_CONF="/etc/nginx/conf.d/locations.inc"
SERVER_DOMAIN="${SERVER_DOMAIN:-}"
CERT_PATH=""
CERT_EXISTS=false
KEY_EXISTS=false

write_http_content_conf() {
    cat > "$DEFAULT_CONF" <<EOF
server {
    listen 8080;
    server_name $1;
    client_max_body_size 12m;

    include $LOCATIONS_CONF;

    location = /health {
        access_log off;
        default_type text/plain;
        return 200 'ok';
    }
}
EOF
}

write_http_redirect_conf() {
    cat > "$DEFAULT_CONF" <<EOF
server {
    listen 8080;
    server_name $1;
    return 301 $2;
}
EOF
}

write_https_conf() {
    cat > "$HTTPS_CONF" <<EOF
server {
    listen 8443 ssl;
    server_name $1;
    client_max_body_size 12m;

    ssl_certificate $CERT_PATH;
    ssl_certificate_key $SSL_KEY;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;

    add_header Strict-Transport-Security "max-age=31536000" always;

    include $LOCATIONS_CONF;
}
EOF
}

write_http_catchall_conf() {
    cat > "$CATCHALL_CONF" <<EOF
server {
    listen 8080 default_server;
    server_name _;

    location = /health {
        access_log off;
        default_type text/plain;
        return 200 'ok';
    }

    location / {
        return 444;
    }
}
EOF
}

write_https_catchall_conf() {
    cat > "$CATCHALL_CONF" <<EOF
server {
    listen 8080 default_server;
    listen 8443 ssl default_server;
    server_name _;

    ssl_certificate $CERT_PATH;
    ssl_certificate_key $SSL_KEY;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;

    location = /health {
        access_log off;
        default_type text/plain;
        return 200 'ok';
    }

    location / {
        return 444;
    }
}
EOF
}

if [ ! -d "$SSL_DIR" ]; then
    echo "No SSL directory found at $SSL_DIR, HTTPS disabled (HTTP only mode)"
    rm -f "$HTTPS_CONF"
    if [ -n "$SERVER_DOMAIN" ]; then
        write_http_content_conf "$SERVER_DOMAIN"
        write_http_catchall_conf
    else
        rm -f "$CATCHALL_CONF"
    fi
    exec /docker-entrypoint.sh "$@"
fi

if [ ! -x "$SSL_DIR" ]; then
    echo "ERROR: SSL directory $SSL_DIR exists but is not accessible (missing execute permission)"
    echo "To fix: chmod 755 <host-ssl-dir> or chmod o+x <host-ssl-dir>"
    echo "HTTPS disabled"
    rm -f "$HTTPS_CONF"
    if [ -n "$SERVER_DOMAIN" ]; then
        write_http_content_conf "$SERVER_DOMAIN"
        write_http_catchall_conf
    else
        rm -f "$CATCHALL_CONF"
    fi
    exec /docker-entrypoint.sh "$@"
fi

if [ -e "$SSL_CERT" ] || [ -e "$SSL_FULLCHAIN" ]; then
    CERT_EXISTS=true
fi

if [ -e "$SSL_KEY" ]; then
    KEY_EXISTS=true
fi

if [ -r "$SSL_CERT" ]; then
    CERT_PATH="$SSL_CERT"
elif [ -r "$SSL_FULLCHAIN" ]; then
    CERT_PATH="$SSL_FULLCHAIN"
fi

if [ -n "$CERT_PATH" ] && [ -r "$SSL_KEY" ]; then
    echo "SSL certificates found, enabling HTTPS..."
    if [ -n "$SERVER_DOMAIN" ]; then
        write_http_redirect_conf "$SERVER_DOMAIN" "https://$SERVER_DOMAIN\$request_uri"
        write_https_conf "$SERVER_DOMAIN"
        write_https_catchall_conf
    else
        write_http_redirect_conf "localhost" "https://\$host\$request_uri"
        write_https_conf "localhost"
        rm -f "$CATCHALL_CONF"
    fi
elif [ "$CERT_EXISTS" = true ] || [ "$KEY_EXISTS" = true ]; then
    echo "ERROR: SSL certificate files exist but are not readable"
    echo "Certificate files found:"
    ls -la "$SSL_DIR"/*.pem 2>/dev/null || echo "none"
    echo "To fix: chmod 644 <host-ssl-dir>/*.pem"
    echo "HTTPS disabled"
    rm -f "$HTTPS_CONF"
    if [ -n "$SERVER_DOMAIN" ]; then
        write_http_content_conf "$SERVER_DOMAIN"
        write_http_catchall_conf
    else
        rm -f "$CATCHALL_CONF"
    fi
else
    echo "No SSL certificates found in $SSL_DIR, HTTPS disabled (HTTP only mode)"
    rm -f "$HTTPS_CONF"
    if [ -n "$SERVER_DOMAIN" ]; then
        write_http_content_conf "$SERVER_DOMAIN"
        write_http_catchall_conf
    else
        rm -f "$CATCHALL_CONF"
    fi
fi

exec /docker-entrypoint.sh "$@"
