from __future__ import annotations

import sys

from PySide6.QtCore import QSettings
from PySide6.QtWidgets import QApplication, QMessageBox, QSplashScreen

import app_v16 as previous

APP_VERSION = "0.17.0"
D2_OWNER = "thedrowned925"
D2_REPO = "drowned2"
D2_BRANCH = "main"


class Launcher(previous.Launcher):
    """Drowned2-only launcher shell on top of the current v16 client.

    The download/install protocol stays exactly the same. This entrypoint only
    isolates local application data/settings and hard-pins the catalog source
    so an old Drowned1 setting can never redirect this launcher.
    """

    def __init__(self):
        super().__init__()

        # Keep Drowned2 settings separate from the legacy Drowned Launcher.
        # QApplication's application name also gives registry/cache files their
        # own AppLocalDataLocation before the inherited constructor runs.
        self.settings = QSettings("Drowned", "Drowned2Launcher")
        self.owner = D2_OWNER
        self.repo = D2_REPO
        self.branch = D2_BRANCH
        self.settings.setValue("owner", D2_OWNER)
        self.settings.setValue("repo", D2_REPO)
        self.settings.setValue("branch", D2_BRANCH)

        self.setWindowTitle(f"Drowned2 Launcher {APP_VERSION}")
        self._refresh_side_panels()

    def load_catalog(self):
        # app_v4 calls self.load_catalog() from inside its constructor. Dynamic
        # dispatch lands here even before this subclass' __init__ has finished,
        # which guarantees the very first network request is already drowned2.
        self.owner = D2_OWNER
        self.repo = D2_REPO
        self.branch = D2_BRANCH
        return super().load_catalog()

    def apply_settings(self, owner: str, repo: str, branch: str):
        # Source switching is intentionally disabled in this dedicated build.
        self.owner = D2_OWNER
        self.repo = D2_REPO
        self.branch = D2_BRANCH
        self.settings.setValue("owner", D2_OWNER)
        self.settings.setValue("repo", D2_REPO)
        self.settings.setValue("branch", D2_BRANCH)
        self.load_catalog()

    def open_settings(self):
        QMessageBox.information(
            self,
            "Drowned2 Launcher",
            "Bu sürüm yalnızca thedrowned925/drowned2 kataloğuna bağlıdır.\n\n"
            "Oyunları Drowned2 Release Manager ile yedeklediğinde catalog.json "
            "otomatik güncellenir ve Launcher yeni sürümü yenilemede görür.\n\n"
            "Kurulum kayıtları, cache ve devam bilgileri Drowned1 Launcher'dan "
            "ayrı tutulur.",
        )


def main():
    previous.BASE.base.install_exception_hook()
    app = QApplication(sys.argv)
    app.setApplicationName("Drowned2 Launcher")
    app.setOrganizationName("Drowned")
    app.setStyle("Fusion")
    app.setStyleSheet(previous.V16_STYLE)

    splash = QSplashScreen(previous.BASE._splash_pixmap())
    splash.show()
    app.processEvents()

    win = Launcher()
    win.show()
    splash.finish(win)
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
