from __future__ import annotations

import sys
from pathlib import Path

from PySide6.QtWidgets import QApplication

import app_v10 as previous
from drowned_shared.steam_detect import SteamDetectionError, detect_steam_game

APP_VERSION = "0.11.0"


class Manager(previous.Manager):
    """Drowned2 manager: manual backup, automatic Steam identity and metadata."""

    def __init__(self):
        self.detected_steam_game = None
        super().__init__()
        self.setWindowTitle(
            f"Drowned2 Release Manager {APP_VERSION} • Steam Auto Detect + Balanced Direct Stream"
        )

    def pick_source(self):
        # Preserve Drowned1's existing folder picker, total-size probe and
        # Balanced Direct Stream upload plan exactly as-is.
        super().pick_source()
        source_text = self.source.text().strip()
        if not source_text:
            return

        try:
            info = detect_steam_game(Path(source_text))
        except SteamDetectionError as exc:
            if hasattr(self, "steam_status"):
                self.steam_status.setText(
                    "Steam eşleşmesi bulunamadı. Klasör yine mevcut manuel metadata "
                    f"akışıyla yedeklenebilir. {exc}"
                )
            return

        self.detected_steam_game = info

        # app_v4+ already exposes a SteamDB/AppID input and asynchronous Steam
        # Store/CDN importer. Fill it automatically instead of asking the user.
        if hasattr(self, "steamdb_url"):
            self.steamdb_url.setText(str(info.app_id))

        if hasattr(self, "game_title") and info.name:
            self.game_title.setText(info.name)

        if hasattr(self, "platform"):
            index = self.platform.findText("PC")
            if index >= 0:
                self.platform.setCurrentIndex(index)

        # Keep release version user-controlled, but expose Steam's build id so a
        # backup can be identified precisely without inventing a store version.
        build_text = f" • Steam build {info.build_id}" if info.build_id else ""
        if hasattr(self, "steam_status"):
            self.steam_status.setText(
                f"✓ Steam AppID {info.app_id} bulundu{build_text}. "
                "Oyun bilgileri, görselleri, ekran görüntüleri ve fragmanları otomatik alınıyor…"
            )

        # Reuse Drowned1's existing pipeline. app_v5 extends this callback to
        # icon, screenshots, trailers and steam_app_id media metadata as well.
        if hasattr(self, "fetch_steam_artwork"):
            self.fetch_steam_artwork()


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("Drowned2 Release Manager")
    app.setOrganizationName("Drowned")
    app.setStyle("Fusion")
    app.setStyleSheet(previous.previous.previous.previous.previous.previous.MODERN_STYLE)
    win = Manager()
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
