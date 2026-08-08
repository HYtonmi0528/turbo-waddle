import json, os
from pathlib import Path

# Try existing Node project config first, then v2's own
existing_path = Path(__file__).parent.parent.parent / "rfq-collaboration-test" / "server-data" / "config.json"
v2_path = Path(__file__).parent.parent / "server-data" / "config.json"
CONFIG_PATH = existing_path if existing_path.exists() else v2_path

def load_config():
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    cfg.setdefault("server", {})
    cfg.setdefault("mysql", {})
    if "sessionSecret" not in cfg:
        import secrets
        cfg["sessionSecret"] = secrets.token_hex(32)
        with open(CONFIG_PATH, "w") as f:
            json.dump(cfg, f, indent=4, ensure_ascii=False)
    return cfg
