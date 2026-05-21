# Scrapling is licensed under BSD-3-Clause (Copyright (c) 2024, Karim Shoair)
# See LICENSE file for the full license text.

FROM pyd4vinci/scrapling:latest

WORKDIR /app

# Copy requirements and install additional dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code and license
COPY . .

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
