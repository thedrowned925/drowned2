from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path


class SteamDetectionError(RuntimeError):
    pass


@dataclass(frozen=True)
class SteamGameInfo:
    app_id: int
    name: str
    install_dir: str
    game_root: Path
    manifest_path: Path | None = None
    build_id: str = ""
    last_updated: str = ""


_PAIR_RE = re.compile(r'^\s*"([^"]+)"\s+"([^"]*)"\s*$')
_LIBRARY_PATH_RE = re.compile(r'^\s*"path"\s+"([^"]+)"', re.IGNORECASE)


def parse_appmanifest(path: Path | str) -> dict[str, str]:
    """Read the flat key/value fields we need from Steam's AppState VDF."""
    manifest = Path(path)
    try:
        text = manifest.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise SteamDetectionError(f"Steam manifest okunamadı: {manifest}: {exc}") from exc

    data: dict[str, str] = {}
    for line in text.splitlines():
        match = _PAIR_RE.match(line)
        if match:
            data[match.group(1).lower()] = match.group(2)
    return data


def _path_key(path: Path) -> str:
    try:
        value = str(path.resolve())
    except OSError:
        value = str(path.absolute())
    return os.path.normcase(value) if os.name == "nt" else value


def _same_or_inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except (ValueError, OSError):
        if os.name != "nt":
            return False
        p = _path_key(path)
        r = _path_key(root).rstrip("\\/")
        return p == r or p.startswith(r + os.sep)


def _steamapps_near_selected(selected: Path) -> list[Path]:
    """Resolve steamapps without depending on Registry when the selected path is already in a library."""
    found: list[Path] = []
    current = selected.resolve()
    for candidate in [current, *current.parents]:
        if candidate.name.lower() == "steamapps":
            found.append(candidate)
        if (
            candidate.parent.name.lower() == "common"
            and candidate.parent.parent.name.lower() == "steamapps"
        ):
            found.append(candidate.parent.parent)
    return found


def _steam_appid_txt(selected: Path) -> int | None:
    """Fallback for games that ship a steam_appid.txt beside the executable."""
    current = selected.resolve()
    for base in [current, *list(current.parents)[:6]]:
        candidate = base / "steam_appid.txt"
        if not candidate.is_file():
            continue
        try:
            lines = candidate.read_text(encoding="utf-8", errors="ignore").strip().splitlines()
            value = lines[0].strip()
        except (OSError, IndexError):
            continue
        if value.isdigit() and int(value) > 0:
            return int(value)
    return None


def _registry_steamapps() -> list[Path]:
    if os.name != "nt":
        return []

    result: list[Path] = []
    try:
        import winreg
    except ImportError:
        return result

    locations = [
        (winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Valve\Steam", "InstallPath"),
    ]
    for hive, key_name, value_name in locations:
        try:
            with winreg.OpenKey(hive, key_name) as key:
                value, _ = winreg.QueryValueEx(key, value_name)
            if value:
                result.append(Path(str(value)) / "steamapps")
        except OSError:
            pass
    return result


def _default_steamapps() -> list[Path]:
    if os.name == "nt":
        return _registry_steamapps()
    return [
        Path.home() / ".steam/steam/steamapps",
        Path.home() / ".local/share/Steam/steamapps",
    ]


def _expand_libraryfolders(roots: list[Path]) -> list[Path]:
    result = list(roots)
    for steamapps in list(roots):
        library_file = steamapps / "libraryfolders.vdf"
        if not library_file.is_file():
            continue
        try:
            text = library_file.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for line in text.splitlines():
            match = _LIBRARY_PATH_RE.match(line)
            if not match:
                continue
            raw = match.group(1).replace("\\\\", "\\")
            result.append(Path(raw) / "steamapps")
    return result


def known_steamapps(selected: Path | str | None = None) -> list[Path]:
    roots: list[Path] = []
    if selected is not None:
        roots.extend(_steamapps_near_selected(Path(selected)))
    roots.extend(_default_steamapps())
    roots = _expand_libraryfolders(roots)

    unique: list[Path] = []
    seen: set[str] = set()
    for item in roots:
        key = _path_key(item)
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique


def _match_manifest(
    selected: Path,
    steamapps: Path,
    forced_appid: int | None = None,
) -> SteamGameInfo | None:
    if not steamapps.is_dir():
        return None

    if forced_appid:
        manifests = [steamapps / f"appmanifest_{forced_appid}.acf"]
    else:
        manifests = sorted(steamapps.glob("appmanifest_*.acf"))

    common = steamapps / "common"
    for manifest in manifests:
        if not manifest.is_file():
            continue
        data = parse_appmanifest(manifest)
        appid_text = str(data.get("appid") or "")
        install_dir = str(data.get("installdir") or "")
        if not appid_text.isdigit() or not install_dir:
            continue

        game_root = common / install_dir
        # Accept the game's root itself and folders below it. Also accept a selected
        # wrapper directory containing exactly this game root, but candidate ranking
        # below prefers the closest match.
        if not (_same_or_inside(selected, game_root) or _same_or_inside(game_root, selected)):
            continue

        return SteamGameInfo(
            app_id=int(appid_text),
            name=str(data.get("name") or install_dir),
            install_dir=install_dir,
            game_root=game_root,
            manifest_path=manifest,
            build_id=str(data.get("buildid") or ""),
            last_updated=str(data.get("lastupdated") or ""),
        )
    return None


def detect_steam_game(selected_folder: Path | str) -> SteamGameInfo:
    """Identify a Steam-installed game from the folder selected by the user.

    Detection does not download or install anything. It only maps the local folder
    back to Steam's appmanifest data so the existing Steam Store metadata importer
    can run automatically.
    """
    selected = Path(selected_folder).expanduser().resolve()
    if not selected.exists() or not selected.is_dir():
        raise SteamDetectionError(f"Geçerli bir oyun klasörü değil: {selected}")

    forced_appid = _steam_appid_txt(selected)

    matches: list[SteamGameInfo] = []
    for steamapps in known_steamapps(selected):
        info = _match_manifest(selected, steamapps, forced_appid=forced_appid)
        if info:
            matches.append(info)

    if matches:
        # Prefer the most specific game-root relationship if a broad parent folder
        # was selected and more than one Steam library happens to match.
        matches.sort(
            key=lambda info: (
                0 if _path_key(selected) == _path_key(info.game_root) else 1,
                abs(len(selected.parts) - len(info.game_root.parts)),
            )
        )
        return matches[0]

    if forced_appid:
        return SteamGameInfo(
            app_id=forced_appid,
            name=selected.name,
            install_dir=selected.name,
            game_root=selected,
        )

    raise SteamDetectionError(
        "Seçilen klasör bir Steam appmanifest kaydıyla eşleştirilemedi. "
        "Oyunun Steam üzerinden kurulu olduğundan ve oyun klasörünü seçtiğinden emin ol."
    )
