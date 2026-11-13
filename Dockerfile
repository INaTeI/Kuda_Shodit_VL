FROM python:3.12.10-slim AS dependencies
WORKDIR /build
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.12.10-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --no-create-home app
COPY --from=dependencies /install /usr/local
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/ready')"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

FROM runtime AS test
USER root
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY tests ./tests
COPY pyproject.toml ./
USER app
CMD ["python", "-m", "pytest", "-q", "--cov=app", "--cov-report=term-missing", "-p", "no:cacheprovider"]
