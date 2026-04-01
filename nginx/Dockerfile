FROM nginxinc/nginx-unprivileged:stable-alpine

COPY --chown=nginx:root --chmod=644 nginx.conf /etc/nginx/nginx.conf
COPY --chown=nginx:root --chmod=664 conf.d/default.conf /etc/nginx/conf.d/default.conf
COPY --chown=nginx:root --chmod=644 conf.d/locations.conf /etc/nginx/conf.d/locations.inc
COPY --chown=nginx:root --chmod=755 docker-entrypoint.sh /https-entrypoint.sh

EXPOSE 8080 8443

ENTRYPOINT ["/https-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
