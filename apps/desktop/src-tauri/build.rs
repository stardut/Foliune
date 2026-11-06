fn main() {
    tauri_build::build();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let source = "src/work_directory/jpeg_macos.c";
        println!("cargo:rerun-if-changed={source}");
        cc::Build::new().file(source).compile("foliune_jpeg_macos");
        let proxy = "src/link_import_proxy_macos.c";
        println!("cargo:rerun-if-changed={proxy}");
        cc::Build::new()
            .file(proxy)
            .compile("foliune_link_import_proxy_macos");
        let airdrop = "src/airdrop_macos.m";
        println!("cargo:rerun-if-changed={airdrop}");
        cc::Build::new()
            .file(airdrop)
            .flag("-fobjc-arc")
            .compile("foliune_airdrop_macos");
        let fullscreen = "src/photo_fullscreen_macos.m";
        println!("cargo:rerun-if-changed={fullscreen}");
        cc::Build::new()
            .file(fullscreen)
            .flag("-fobjc-arc")
            .compile("foliune_photo_fullscreen_macos");
        for framework in [
            "AppKit",
            "CFNetwork",
            "CoreFoundation",
            "CoreGraphics",
            "ImageIO",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
}
