fn main() {
    write_shooting_region_labels();
    tauri_build::build();
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "macos" {
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
        let context_menu = "src/context_menu_macos.m";
        println!("cargo:rerun-if-changed={context_menu}");
        cc::Build::new()
            .file(context_menu)
            .flag("-fobjc-arc")
            .compile("foliune_context_menu_macos");
        let local_photo_picker = "src/local_photo_picker_macos.m";
        println!("cargo:rerun-if-changed={local_photo_picker}");
        cc::Build::new()
            .file(local_photo_picker)
            .flag("-fobjc-arc")
            .compile("foliune_local_photo_picker_macos");
        if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("aarch64") {
            let update_quit = "src/app_updates/termination_macos.m";
            println!("cargo:rerun-if-changed={update_quit}");
            cc::Build::new()
                .file(update_quit)
                .flag("-fobjc-arc")
                .compile("foliune_update_termination_macos");
        }
        for framework in [
            "AppKit",
            "CFNetwork",
            "CoreFoundation",
            "CoreGraphics",
            "ImageIO",
            "UniformTypeIdentifiers",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
    if target_os == "windows" {
        let source = "src/local_photo_picker_windows.cpp";
        println!("cargo:rerun-if-changed={source}");
        cc::Build::new()
            .cpp(true)
            .file(source)
            .flag_if_supported("/utf-8")
            .compile("foliune_local_photo_picker_windows");
        println!("cargo:rustc-link-lib=ole32");
        println!("cargo:rustc-link-lib=uuid");
    }
}

fn write_shooting_region_labels() {
    use std::{collections::HashMap, env, fs, path::PathBuf};

    fn read_atlas(source: &str) -> serde_json::Value {
        println!("cargo:rerun-if-changed={source}");
        let input = fs::read(source).unwrap_or_else(|error| panic!("read {source}: {error}"));
        serde_json::from_slice(&input).unwrap_or_else(|error| panic!("parse {source}: {error}"))
    }

    let mut global = read_atlas("../src/features/works-map/natural-earth-regions.json");
    let mut cities = read_atlas("../src/features/works-map/china-city-regions.json");
    let regions: Vec<[String; 5]> =
        serde_json::from_value(global["labels"].take()).expect("parse global region labels");
    let city_labels: Vec<[String; 5]> =
        serde_json::from_value(cities["labels"].take()).expect("parse Chinese city labels");
    let parents: Vec<String> =
        serde_json::from_value(cities["parents"].take()).expect("parse Chinese city parent IDs");
    assert_eq!(
        city_labels.len(),
        parents.len(),
        "missing Chinese city parent IDs"
    );

    let names: HashMap<_, _> = regions
        .iter()
        .map(|[id, chinese, ..]| (id.as_str(), chinese))
        .collect();
    let mut labels: Vec<_> = regions
        .iter()
        .map(|[id, chinese, country, english, _]| [id, chinese, country, english])
        .collect();
    labels.extend(
        city_labels
            .iter()
            .zip(parents)
            .map(|([id, chinese, _, english, _], parent)| {
                let province = names
                    .get(parent.as_str())
                    .unwrap_or_else(|| panic!("missing parent {parent} for {id}"));
                [id, chinese, province, english]
            }),
    );
    let output = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo output directory"));
    fs::write(
        output.join("shooting-region-labels.json"),
        serde_json::to_vec(&labels).expect("encode the atlas region labels"),
    )
    .expect("write the atlas region labels");
}
