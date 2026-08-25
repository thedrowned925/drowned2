import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from drowned_shared.steam_detect import (
    SteamDetectionError,
    detect_steam_game,
    parse_appmanifest,
)


class SteamDetectTests(unittest.TestCase):
    def _make_game(self, root: Path, app_id: int = 620, name: str = "Portal 2"):
        steamapps = root / "steamapps"
        game = steamapps / "common" / name
        game.mkdir(parents=True)
        manifest = steamapps / f"appmanifest_{app_id}.acf"
        manifest.write_text(
            '"AppState"\n{\n'
            f'  "appid" "{app_id}"\n'
            f'  "name" "{name}"\n'
            f'  "installdir" "{name}"\n'
            '  "buildid" "123456"\n'
            '  "LastUpdated" "1770000000"\n'
            '}\n',
            encoding="utf-8",
        )
        return steamapps, game, manifest

    def assertSamePath(self, left: Path, right: Path):
        # GitHub's Windows runner may expose the same temp directory as both
        # C:\\Users\\RUNNER~1 and C:\\Users\\runneradmin. samefile compares the
        # actual filesystem identity instead of the textual spelling.
        self.assertTrue(os.path.samefile(left, right), f"Paths differ: {left} != {right}")

    def test_parse_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            _, _, manifest = self._make_game(Path(tmp))
            data = parse_appmanifest(manifest)
            self.assertEqual(data["appid"], "620")
            self.assertEqual(data["installdir"], "Portal 2")
            self.assertEqual(data["buildid"], "123456")

    def test_detects_game_root_from_nearby_appmanifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            _, game, _ = self._make_game(Path(tmp))
            with patch("drowned_shared.steam_detect._default_steamapps", return_value=[]):
                info = detect_steam_game(game)
            self.assertEqual(info.app_id, 620)
            self.assertEqual(info.name, "Portal 2")
            self.assertEqual(info.build_id, "123456")
            self.assertSamePath(info.game_root, game)

    def test_detects_subfolder_of_game(self):
        with tempfile.TemporaryDirectory() as tmp:
            _, game, _ = self._make_game(Path(tmp))
            selected = game / "bin" / "win64"
            selected.mkdir(parents=True)
            with patch("drowned_shared.steam_detect._default_steamapps", return_value=[]):
                info = detect_steam_game(selected)
            self.assertEqual(info.app_id, 620)
            self.assertSamePath(info.game_root, game)

    def test_steam_appid_txt_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            game = Path(tmp) / "Loose Steam Game"
            game.mkdir()
            (game / "steam_appid.txt").write_text("730\n", encoding="utf-8")
            with patch("drowned_shared.steam_detect.known_steamapps", return_value=[]):
                info = detect_steam_game(game)
            self.assertEqual(info.app_id, 730)
            self.assertSamePath(info.game_root, game)

    def test_rejects_non_steam_folder_without_fallback(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "not-steam"
            folder.mkdir()
            with patch("drowned_shared.steam_detect.known_steamapps", return_value=[]):
                with self.assertRaises(SteamDetectionError):
                    detect_steam_game(folder)


if __name__ == "__main__":
    unittest.main()
