# AUR `cardmirror-bin`

Reference copy of the AUR `cardmirror-bin` PKGBUILD. The actual
submission lives in a separate Git repo on `aur.archlinux.org`;
this folder is the canonical source we keep in version control so
edits go through normal PR review.

The PKGBUILD fetches the official x86_64 AppImage from
`https://github.com/ant981228/cardmirror/releases/download/v${_origver}/CardMirror-${_origver}.AppImage`,
extracts it, and installs the contents into `/opt/cardmirror` with
a `/usr/bin/cardmirror` symlink + a `.desktop` entry. Standard
AUR-bin pattern for Electron apps.

## First submission

You only do this once per package name. Skip to "Releasing an
update" if `cardmirror-bin` is already on AUR.

1. Create an AUR account at <https://aur.archlinux.org/register>
   if you don't have one. Add your SSH public key to the AUR
   profile — submissions go through SSH.
2. Clone the AUR git repo for the package name (it's created on
   first push):
   ```sh
   git clone ssh://aur@aur.archlinux.org/cardmirror-bin.git
   ```
3. Copy this folder's `PKGBUILD` into that clone.
4. Generate `.SRCINFO` (AUR requires it; auto-generated from
   PKGBUILD):
   ```sh
   makepkg --printsrcinfo > .SRCINFO
   ```
5. Sanity-test the build locally:
   ```sh
   makepkg -si
   ```
   This builds the package, installs it, and runs the .desktop
   integration. Confirm CardMirror launches from your app menu
   and from `cardmirror` in a terminal.
6. Commit + push:
   ```sh
   git add PKGBUILD .SRCINFO
   git commit -m "Initial import: cardmirror-bin 0.1.0_alpha.1-1"
   git push
   ```

## Releasing an update

For every new CardMirror release that should ship via AUR:

1. In this repo's `packaging/aur/PKGBUILD`, bump `_origver` to
   the new tag (without the `v` prefix) and reset `pkgrel=1`.
   Increment `pkgrel` instead of `_origver` for AUR-only changes
   (PKGBUILD fixes, dependency tweaks).
2. If you're enforcing checksums (recommended after the alpha
   stabilizes), run `updpkgsums` to refresh `sha256sums`.
3. Commit + open a PR to merge the bump.
4. Once merged, `cd` into your local AUR clone (`cardmirror-bin`):
   ```sh
   cp /path/to/cardmirror/packaging/aur/PKGBUILD .
   makepkg --printsrcinfo > .SRCINFO
   makepkg -si        # local install sanity test
   git add PKGBUILD .SRCINFO
   git commit -m "Update to ${_origver}"
   git push
   ```

## Notes on the two update paths

Users who install via this PKGBUILD have two ways to get a newer
CardMirror:

- **`yay -Syu` / `pamac upgrade`** — pulls a new PKGBUILD when
  `_origver` is bumped on AUR. Standard Arch flow.
- **In-app auto-updater** — CardMirror's main process checks
  GitHub Releases on launch and offers a restart-to-install
  prompt when a new version is available. Drops the new AppImage
  into a per-user cache and re-execs.

Both work. The in-app path is faster (no waiting for the AUR
maintainer to bump `_origver`); the AUR path is more in-keeping
with system-level package management. Power users typically
prefer the AUR flow and may want to disable the in-app updater —
that's a planned setting; until then both are active.
