# Repository delivery rules

- Every delivered code, viewer, plugin, or documentation update must also produce a fresh installable
  `QuickLook.Plugin.TrailViewer-<version>.qlplugin` test package.
- Build the Release project, run `node scripts/pack.cjs`, verify the package version and contents, and report
  the absolute package path, size, and SHA256.
- Never overwrite a package for an already released version. Advance the product version before packaging when
  the current version has already been published.
