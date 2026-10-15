"""Build the versioned ComfyUI plugin ZIP using only the Python standard library."""

import hashlib
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


def build_package():
    root = Path(__file__).resolve().parents[1]
    plugin = root / "comfyui" / "ComfyUI-CheapBuddy"
    metadata = (plugin / "pyproject.toml").read_text(encoding="utf-8")
    version = re.search(r'^version = "([0-9]+\.[0-9]+\.[0-9]+)"$', metadata, re.MULTILINE)
    if not version:
        raise ValueError("Plugin version is missing")
    destination = root / "public" / "downloads"
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / f"ComfyUI-CheapBuddy-{version.group(1)}.zip"
    entries = []
    for path in sorted(plugin.rglob("*")):
        relative = path.relative_to(plugin)
        if not path.is_file() or any(part.startswith(".") or part == "__pycache__" for part in relative.parts):
            continue
        if path.suffix not in {".py", ".js", ".mjs", ".json", ".toml", ".md"}:
            continue
        content = path.read_bytes()
        if re.search(rb"sk-[A-Za-z0-9_-]{24,}", content):
            raise ValueError(f"Possible real API key found in {relative}; packaging refused")
        entries.append((relative, content))

    with ZipFile(archive, "w", compression=ZIP_DEFLATED, compresslevel=9) as output:
        for relative, content in entries:
            info = ZipInfo(f"ComfyUI-CheapBuddy/{relative.as_posix()}", date_time=(2026, 10, 7, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            output.writestr(info, content)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix(".zip.sha256").write_text(f"{digest}  {archive.name}\n", encoding="utf-8")
    print(f"Built {archive.name}: {len(entries)} files, {archive.stat().st_size} bytes")
    print(f"SHA-256: {digest}")


if __name__ == "__main__":
    build_package()
