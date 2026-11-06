fn main() {
    tauri_build::build();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let source = "src/work_directory/jpeg_macos.c";
        println!("cargo:rerun-if-changed={source}");
        cc::Build::new().file(source).compile("foliune_jpeg_macos");
        let airdrop = "src/airdrop_macos.m";
        println!("cargo:rerun-if-changed={airdrop}");
        cc::Build::new()
            .file(airdrop)
            .flag("-fobjc-arc")
            .compile("foliune_airdrop_macos");
        for framework in ["AppKit", "CoreFoundation", "CoreGraphics", "ImageIO"] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
}
