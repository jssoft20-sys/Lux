FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libzbar0 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt pyproject.toml ./
COPY backend ./backend
COPY bot ./bot
COPY frontend ./frontend
COPY migrations ./migrations
COPY alembic.ini ./
RUN pip install --no-cache-dir -r requirements.txt zxing-cpp && pip install --no-cache-dir -e .
RUN useradd -m paygo && mkdir -p /app/data && chown -R paygo /app
USER paygo
EXPOSE 7035
CMD ["python", "-m", "paygo.server"]
