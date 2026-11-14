"""Start a throwaway backend for end-to-end tests (fresh data dir every run)."""
import os
import shutil
import sys
from pathlib import Path

import uvicorn

data = Path(os.environ.get("HAUL_DATA_DIR", "e2e-data")).resolve()
shutil.rmtree(data, ignore_errors=True)
os.environ["HAUL_DATA_DIR"] = str(data)
os.environ.setdefault("HAUL_ALLOW_PRIVATE_NETWORKS", "true")
os.environ.setdefault("HAUL_RATE_LIMIT_PER_MINUTE", "0")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
uvicorn.run("app.main:app", host="127.0.0.1", port=int(sys.argv[1] if len(sys.argv) > 1 else 8010), log_level="warning")
