# Unit-Tests

Unit-Tests liegen direkt neben dem Code:

* Rust: `#[cfg(test)]`-Module in `services/daw-bridge/src/*.rs` und `apps/desktop/src-tauri/src/settings.rs` → `cargo test --workspace`
* TypeScript: `packages/protocol/src/*.test.ts`, `apps/desktop/src/*.test.tsx` → `npx vitest run`
