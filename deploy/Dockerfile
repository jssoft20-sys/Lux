# Sprinter Go — образ на nginx:alpine
# Сборка из корня сайта:  docker build -t sprinter-go -f deploy/Dockerfile .
# Запуск:                 docker run -d --name sprinter-go -p 7022:80 --restart unless-stopped sprinter-go
FROM nginx:alpine
COPY deploy/nginx-docker.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html
RUN rm -rf /usr/share/nginx/html/deploy /usr/share/nginx/html/server.py /usr/share/nginx/html/*.sh \
           /usr/share/nginx/html/README.md /usr/share/nginx/html/server.log /usr/share/nginx/html/.server.pid 2>/dev/null || true
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
