FROM python:3.13-slim
WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:0.12.6 /uv /uvx /bin/
COPY apps/agent-service /app
RUN uv sync --frozen --no-dev
EXPOSE 8000
CMD ["uv", "run", "--no-dev", "--no-sync", "uvicorn", "reso_agent.app:app", "--host", "0.0.0.0", "--port", "8000"]
