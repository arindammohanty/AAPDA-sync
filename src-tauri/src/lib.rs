use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use tauri::http::Response;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .register_uri_scheme_protocol("pmtiles", |_app, request| {
        let uri = request.uri().path();
        // Resolve path securely in production. For MVP, we map to root dir.
        let file_path = format!(".{}", uri); 
        
        let mut file = match File::open(&file_path) {
            Ok(f) => f,
            Err(_) => return Response::builder().status(404).body(Vec::new()).unwrap(),
        };

        let mut start = 0;
        let mut end = None;
        if let Some(range_header) = request.headers().get("Range") {
            if let Ok(range_str) = range_header.to_str() {
                if range_str.starts_with("bytes=") {
                    let parts: Vec<&str> = range_str[6..].split('-').collect();
                    if parts.len() >= 1 && !parts[0].is_empty() {
                        start = parts[0].parse::<u64>().unwrap_or(0);
                    }
                    if parts.len() >= 2 && !parts[1].is_empty() {
                        end = Some(parts[1].parse::<u64>().unwrap_or(0));
                    }
                }
            }
        }

        let file_size = file.metadata().map(|m| m.len()).unwrap_or(0);
        let end_pos = end.unwrap_or(file_size.saturating_sub(1));
        let chunk_size = (end_pos.saturating_sub(start) + 1) as usize;

        if start > 0 {
            let _ = file.seek(SeekFrom::Start(start));
        }

        let mut buffer = vec![0; chunk_size];
        let _ = file.read_exact(&mut buffer);

        Response::builder()
            .status(206)
            .header("Content-Range", format!("bytes {}-{}/{}", start, end_pos, file_size))
            .header("Accept-Ranges", "bytes")
            .header("Content-Type", "application/octet-stream")
            .header("Access-Control-Allow-Origin", "*")
            .body(buffer)
            .unwrap()
    })
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
