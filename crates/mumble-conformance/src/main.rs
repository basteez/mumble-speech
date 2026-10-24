//! `generate` writes the conformance files from the current core; `check` verifies them.

use mumble_conformance::{check, outputs, workspace_root};
use std::process::ExitCode;

fn main() -> ExitCode {
    match std::env::args().nth(1).as_deref() {
        Some("generate") => {
            for (path, content) in outputs() {
                let full = workspace_root().join(path);
                std::fs::create_dir_all(full.parent().unwrap()).expect("create directory");
                std::fs::write(&full, content).expect("write file");
                println!("wrote {path}");
            }
            ExitCode::SUCCESS
        }
        Some("check") => match check() {
            Ok(()) => {
                println!("conformance vectors match the current core");
                ExitCode::SUCCESS
            }
            Err(message) => {
                eprintln!("{message}");
                ExitCode::FAILURE
            }
        },
        _ => {
            eprintln!("usage: mumble-conformance <generate|check>");
            ExitCode::from(2)
        }
    }
}
