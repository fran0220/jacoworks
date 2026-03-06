fn main() {
    // Export target triple for sidecar binary resolution at runtime
    let target = std::env::var("TARGET").unwrap_or_default();
    println!("cargo:rustc-env=TARGET_TRIPLE={}", target);

    // Ensure sidecar binary exists for Tauri validation.
    // Release builds must include a real sidecar binary.
    let ext = if target.contains("windows") { ".exe" } else { "" };
    let sidecar_path = format!("binaries/vm-agent-{}{}", target, ext);
    let profile = std::env::var("PROFILE").unwrap_or_default();
    if profile == "release" {
        let path = std::path::Path::new(&sidecar_path);
        let is_real = path.exists() && path.metadata().map(|m| m.len() >= 1024).unwrap_or(false);
        if !is_real {
            panic!(
                "Release build requires real sidecar binary (>= 1KB): {}\n\
                 Run the appropriate build command for target '{}'",
                sidecar_path, target
            );
        }
    }

    // Dev: create a tiny placeholder only when missing.
    if !std::path::Path::new(&sidecar_path).exists() {
        std::fs::create_dir_all("binaries").ok();
        std::fs::write(&sidecar_path, "#!/bin/sh\necho 'dev placeholder'").ok();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(
                &sidecar_path,
                std::fs::Permissions::from_mode(0o755),
            )
            .ok();
        }
    }

    // Ensure resource files exist for Tauri validation
    std::fs::create_dir_all("resources/pi-meta").ok();
    std::fs::create_dir_all("resources/win-bash/usr/bin").ok();
    std::fs::create_dir_all("resources/win-bin").ok();

    // Dev placeholder for doc-packages (real archive created by prepare-release.sh)
    let doc_pkg = "resources/doc-packages.tar.gz";
    if !std::path::Path::new(doc_pkg).exists() {
        // Minimal valid gzip so Tauri doesn't complain about missing resource.
        // Runtime extraction will find it empty and fall back to npm install.
        std::fs::write(doc_pkg, include_bytes!("resources/doc-packages-placeholder.gz")).ok();
    }

    tauri_build::build()
}
