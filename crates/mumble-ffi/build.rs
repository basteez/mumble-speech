// On macOS, give the dylib a relocatable install name so hosts (Unity, Godot, apps)
// can load it from wherever they ship it, instead of this machine's target/ path.
fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-cdylib-link-arg=-Wl,-install_name,@rpath/libmumble_ffi.dylib");
    }
}
