use std::process::{Child, Command};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU16, Ordering};
use tauri::{Manager, State, AppHandle, Emitter};
use std::path::PathBuf;
use std::fs::File;
use std::io::Write;
use futures_util::StreamExt;

#[cfg(target_os = "linux")]
use std::os::unix::process::CommandExt;

struct BackendState {
    port: AtomicU16,
    child: Mutex<Option<Child>>,
}

impl Drop for BackendState {
    fn drop(&mut self) {
        let mut child_guard = self.child.lock().unwrap();
        if let Some(mut child) = child_guard.take() {
            println!("[Tauri] Killing backend child process...");
            let _ = child.kill();
        }
    }
}

fn get_free_port() -> Option<u16> {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .ok()
}

#[derive(Clone, serde::Serialize)]
struct DownloadProgress {
    progress: u8,
    message: String,
}

async fn spawn_backend_on_port(binary_path: &PathBuf, state: &BackendState) -> Result<u16, String> {
    // If already running on dynamic port, return it
    let current_port = state.port.load(Ordering::Relaxed);
    if current_port != 5000 && current_port != 0 {
        let child_guard = state.child.lock().unwrap();
        if child_guard.is_some() {
            return Ok(current_port);
        }
    }

    // Resolve free dynamic port
    let free_port = get_free_port().ok_or_else(|| "Failed to allocate free port".to_string())?;
    
    let mut cmd = Command::new(binary_path);
    cmd.arg(format!("--port={}", free_port));

    #[cfg(target_os = "linux")]
    unsafe {
        cmd.pre_exec(move || {
            libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
            Ok(())
        });
    }

    match cmd.spawn() {
        Ok(child) => {
            state.port.store(free_port, Ordering::Relaxed);
            let mut child_guard = state.child.lock().unwrap();
            *child_guard = Some(child);
            Ok(free_port)
        }
        Err(e) => Err(format!("Failed to spawn backend process: {}", e))
    }
}

async fn download_backend_binary(app: AppHandle, dest_path: PathBuf) -> Result<(), String> {
    let arch = if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        return Err("Unsupported architecture".to_string());
    };

    let platform = if cfg!(target_os = "windows") {
        "pc-windows-msvc"
    } else if cfg!(target_os = "macos") {
        "apple-darwin"
    } else if cfg!(target_os = "linux") {
        "unknown-linux-gnu"
    } else {
        return Err("Unsupported operating system".to_string());
    };

    let filename = if cfg!(target_os = "windows") {
        format!("vaultagent-backend-{}-{}.exe", arch, platform)
    } else {
        format!("vaultagent-backend-{}-{}", arch, platform)
    };

    let url = format!("https://github.com/MIHIRrPATIL/VaultAgent/releases/latest/download/{}", filename);
    println!("[Tauri Downloader] Requesting: {}", url);

    let client = reqwest::Client::new();
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("Server returned HTTP status code {}", res.status()));
    }

    let total_size = res.content_length().unwrap_or(0);
    let mut file = File::create(&dest_path).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut stream = res.bytes_stream();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        if total_size > 0 {
            let pct = ((downloaded as f64 / total_size as f64) * 100.0) as u8;
            let _ = app.emit("backend-download-status", DownloadProgress {
                progress: pct,
                message: format!("Downloading backend: {}% ({:.1}MB / {:.1}MB)", pct, downloaded as f64 / 1024.0 / 1024.0, total_size as f64 / 1024.0 / 1024.0)
            });
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&dest_path).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&dest_path, perms).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
async fn check_and_start_backend(app: AppHandle, state: State<'_, BackendState>) -> Result<serde_json::Value, String> {
    if cfg!(debug_assertions) {
        state.port.store(5000, Ordering::Relaxed);
        return Ok(serde_json::json!({ "status": "ready", "port": 5000 }));
    }

    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let binary_dir = app_data_dir.join("binaries");
    std::fs::create_dir_all(&binary_dir).map_err(|e| e.to_string())?;

    let binary_name = if cfg!(target_os = "windows") {
        "vaultagent-backend.exe"
    } else {
        "vaultagent-backend"
    };
    let binary_path = binary_dir.join(binary_name);

    if binary_path.exists() {
        let spawned = spawn_backend_on_port(&binary_path, &state).await?;
        return Ok(serde_json::json!({ "status": "ready", "port": spawned }));
    }

    let binary_path_clone = binary_path.clone();
    let app_clone = app.clone();

    tokio::spawn(async move {
        if let Err(e) = download_backend_binary(app_clone.clone(), binary_path_clone.clone()).await {
            eprintln!("[Tauri Downloader] Error: {}", e);
            let _ = app_clone.emit("backend-download-status", DownloadProgress {
                progress: 0,
                message: format!("Error downloading: {}", e)
            });
            return;
        }

        let state_clone = app_clone.state::<BackendState>();
        match spawn_backend_on_port(&binary_path_clone, &state_clone).await {
            Ok(port) => {
                println!("[Tauri Downloader] Spawned backend successfully on port {}", port);
                let _ = app_clone.emit("backend-download-status", DownloadProgress {
                    progress: 100,
                    message: "Ready".to_string()
                });
            }
            Err(e) => {
                eprintln!("[Tauri Downloader] Spawn error: {}", e);
                let _ = app_clone.emit("backend-download-status", DownloadProgress {
                    progress: 0,
                    message: format!("Failed to start server: {}", e)
                });
            }
        }
    });

    Ok(serde_json::json!({ "status": "downloading" }))
}

#[tauri::command]
fn get_backend_port(state: State<'_, BackendState>) -> u16 {
    state.port.load(Ordering::Relaxed)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    {
        // Fix EGL display crashes on newer Linux graphics drivers (Wayland/NVIDIA)
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_stronghold::Builder::new(|_salt| {
            vec![12, 34, 56, 78, 90, 12, 34, 56, 78, 90, 12, 34, 56, 78, 90, 12, 34, 56, 78, 90, 12, 34, 56, 78, 90, 12, 34, 56, 78, 90, 12, 34]
        }).build())
        .setup(|app| {
            app.manage(BackendState {
                port: AtomicU16::new(0),
                child: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_backend_port, check_and_start_backend])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
