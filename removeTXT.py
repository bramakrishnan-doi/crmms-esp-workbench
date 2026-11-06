from pathlib import Path

ROOT = Path(__file__).resolve().parent


def restore_extensions(root: Path) -> None:
    restored = 0
    skipped = 0

    for path in root.rglob("*"):
        if not path.is_file():
            continue

        # We only want files that were renamed by the transfer script.
        if path.suffix.lower() != ".txt":
            skipped += 1
            continue

        original_name = path.name[:-4]  # Remove final ".txt"
        original_path = path.with_name(original_name)

        # Never overwrite an existing file.
        if original_path.exists():
            print(f"SKIP (target exists): {path}")
            skipped += 1
            continue

        path.rename(original_path)
        print(f"RESTORED: {path} -> {original_path}")
        restored += 1

    print()
    print(f"Done. Restored: {restored}, skipped: {skipped}")


if __name__ == "__main__":
    restore_extensions(ROOT)