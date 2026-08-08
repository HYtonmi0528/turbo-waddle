import json, os
from pathlib import Path

CONFIG_PATH = Path(os.environ.get("LATIC_CONFIG", Path(__file__).parent.parent / "server-data" / "config.json"))

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
