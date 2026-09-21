FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 TZ=UTC
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY bot ./bot
COPY .env.example .

RUN useradd -r -u 10001 lux && mkdir -p /app/data && chown -R lux:lux /app
USER lux
VOLUME ["/app/data"]
EXPOSE 7066

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:7066/api/health', timeout=4).status==200 else 1)"

CMD ["python", "-m", "bot.main"]
