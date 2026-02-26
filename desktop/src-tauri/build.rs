fn main() {
    // Export target triple for sidecar binary resolution at runtime
    let target = std::env::var("TARGET").unwrap_or_default();
    println!("cargo:rustc-env=TARGET_TRIPLE={}", target);

    // Ensure sidecar binary exists for Tauri validation (dev placeholder)
    let ext = if target.contains("windows") { ".exe" } else { "" };
    let sidecar_path = format!("binaries/vm-agent-{}{}", target, ext);
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
    if !std::path::Path::new("resources/skills.tar.gz").exists() {
        // Create an empty tar.gz placeholder for dev builds
        std::fs::write("resources/skills.tar.gz", &[
            0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03,
            0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ]).ok();
    }

    tauri_build::build()
}
