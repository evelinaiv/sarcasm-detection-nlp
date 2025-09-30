# Read the doc: https://huggingface.co/docs/hub/spaces-sdks-docker
FROM python:3.9

# Create non-root user
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"

# Set working directory
WORKDIR /app

# Install dependencies
COPY --chown=user ./requirements.txt requirements.txt
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# Copy all app files
COPY --chown=user . /app

# Start FastAPI with Uvicorn on port 7860 (needed for HF Spaces)
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]

