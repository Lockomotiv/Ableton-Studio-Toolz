// Verhindert unter Windows (Release) ein zusätzliches Konsolenfenster.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lom_connect_studio_lib::run()
}
