"""Build a source/static release with an explicit allowlist, never local secrets."""

from pathlib import Path
import tarfile


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    web = root / "frontend"
    if not (web / "index.html").is_file():
        raise SystemExit("Missing frontend/index.html")
    files = [root / "backend" / "requirements.txt"]
    files.extend(
        path for path in (root / "backend" / "app").rglob("*")
        if path.is_file() and "__pycache__" not in path.parts and path.suffix not in {".pyc", ".pyo"}
    )
    files.extend(path for path in web.rglob("*") if path.is_file())
    files.extend((root / "data").glob("*.json"))
    files.extend(path for path in (root / "deploy" / "vm").iterdir() if path.is_file())
    output = root / "dist" / "nasa2026-release.tar.gz"
    output.parent.mkdir(exist_ok=True)
    with tarfile.open(output, "w:gz") as archive:
        for path in sorted(files):
            if path.is_symlink() or path.name.startswith(".env"):
                raise SystemExit(f"Refusing to package unexpected file: {path}")
            archive.add(path, arcname=path.relative_to(root).as_posix(), recursive=False)
    print(f"Release: {output} ({len(files)} files)")


if __name__ == "__main__":
    main()
