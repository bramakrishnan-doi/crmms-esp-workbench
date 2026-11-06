from pathlib import Path

# Change this if you want to target a different folder.
# Using "." means "the folder containing this script."
ROOT = Path(__file__).resolve().parent


def rename_files(root: Path) -> None:
    renamed = 0
    skipped = 0

    for path in root.rglob("*"):
        # Do not rename directories
        if not path.is_file():
            continue

        # Do not rename this script itself
        if path.resolve() == Path(__file__).resolve():
            skipped += 1
            continue

        # Already has .txt
        if path.name.lower().endswith(".txt"):
            skipped += 1
            continue

        new_path = path.with_name(path.name + ".txt")

        # Avoid overwriting anything
        if new_path.exists():
            print(f"SKIP (target exists): {path}")
            skipped += 1
            continue

        path.rename(new_path)
        print(f"RENAMED: {path} -> {new_path}")
        renamed += 1

    print()
    print(f"Done. Renamed: {renamed}, skipped: {skipped}")


if __name__ == "__main__":
    rename_files(ROOT)