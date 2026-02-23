mod cowork;
mod stream;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            stream::stream_fetch,
            stream::stream_abort,
            stream::http_fetch,
            cowork::select_directory,
            cowork::tar_directory,
            cowork::extract_tar,
            cowork::upload_cowork,
            cowork::download_cowork,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
