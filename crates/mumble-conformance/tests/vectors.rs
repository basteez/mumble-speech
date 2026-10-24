//! The committed vectors must match what the core produces on this platform (L1.4, L5.2).

#[test]
fn committed_vectors_match_the_core_on_this_platform() {
    if let Err(message) = mumble_conformance::check() {
        panic!("{message}\nIf the change is intentional (and in the specs), run `cargo run -p mumble-conformance -- generate`.");
    }
}
