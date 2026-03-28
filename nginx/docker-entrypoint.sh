#!/bin/sh
set -e

SSL_DIR="/etc/nginx/ssl"
SSL_CERT="$SSL_DIR/cert.pem"
SSL_FULLCHAIN="$SSL_DIR/fullchain.pem"
SSL_KEY="$SSL_DIR/key.pem"
HTTPS_CONF="/etc/nginx/conf.d/https.conf"
CERT_PATH=""
CERT_EXISTS=false
KEY_EXISTS=false

if [ ! -d "$SSL_DIR" ]; then
    echo "No SSL directory found at $SSL_DIR, HTTPS disabled (HTTP only mode)"
    rm -f "$HTTPS_CONF"
    exec /docker-entrypoint.sh "$@"
fi

if [ ! -x "$SSL_DIR" ]; then
    echo "ERROR: SSL directory $SSL_DIR exists but is not accessible (missing execute permission)"
    echo "To fix: chmod 755 <host-ssl-dir> or chmod o+x <host-ssl-dir>"
    echo "HTTPS disabled"
    rm -f "$HTTPS_CONF"
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
    cat > "$HTTPS_CONF" <<EOF
server {
    listen 8443 ssl;
    server_name localhost;
    client_max_body_size 12m;

    ssl_certificate $CERT_PATH;
    ssl_certificate_key $SSL_KEY;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:50m;

    include /etc/nginx/conf.d/locations.inc;
}
EOF
elif [ "$CERT_EXISTS" = true ] || [ "$KEY_EXISTS" = true ]; then
    echo "ERROR: SSL certificate files exist but are not readable"
    echo "Certificate files found:"
    ls -la "$SSL_DIR"/*.pem 2>/dev/null || echo "none"
    echo "To fix: chmod 644 <host-ssl-dir>/*.pem"
    echo "HTTPS disabled"
    rm -f "$HTTPS_CONF"
else
    echo "No SSL certificates found in $SSL_DIR, HTTPS disabled (HTTP only mode)"
    rm -f "$HTTPS_CONF"
fi

exec /docker-entrypoint.sh "$@"
