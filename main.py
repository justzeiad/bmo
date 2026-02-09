import os
import yaml
import uvicorn


def _config_path(name: str) -> str:
    here = os.path.dirname(__file__)
    return os.path.abspath(os.path.join(here, "ai", "config", name))


def _load_yaml(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def main() -> None:
    settings_path = os.getenv("BMO_SETTINGS", _config_path("settings.yaml"))
    settings = _load_yaml(settings_path)
    network = settings.get("network", {})
    host = network.get("host", "0.0.0.0")
    port = int(network.get("http_port", 8000))
    uvicorn.run("ai.api.websocket:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
