import os

# Render automatically injects the PORT environment variable (typically 10000)
port = os.environ.get("PORT", "5000")
bind = f"0.0.0.0:{port}"

workers = 2
threads = 4
timeout = 120
accesslog = "-"
errorlog = "-"
