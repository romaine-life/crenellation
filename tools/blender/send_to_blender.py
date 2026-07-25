import argparse
import urllib.error
import json
import sys
import urllib.request


DEFAULT_URL = "http://127.0.0.1:8765/run"


def main():
    parser = argparse.ArgumentParser(description="Send Python code to the live Blender bridge.")
    parser.add_argument("script", help="Path to the Python script to execute in Blender.")
    parser.add_argument("--url", default=DEFAULT_URL)
    args = parser.parse_args()

    with open(args.script, "r", encoding="utf-8") as handle:
        code = handle.read()

    request = urllib.request.Request(
        args.url,
        data=json.dumps({"code": code}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8")
        except Exception:
            body = ""
        print(f"Blender bridge returned HTTP {exc.code}: {body}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Failed to send script to Blender: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(payload, indent=2))
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
