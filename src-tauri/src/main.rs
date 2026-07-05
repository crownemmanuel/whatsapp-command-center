use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::sync::Mutex;
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

#[derive(Default)]
struct BackendState {
    url: Mutex<Option<String>>,
    error: Mutex<Option<String>>,
    child: Mutex<Option<CommandChild>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendStatus {
    ready: bool,
    url: Option<String>,
    error: Option<String>,
}

#[tauri::command]
fn backend_status(state: State<'_, BackendState>) -> BackendStatus {
    let url = state.url.lock().expect("backend url lock").clone();
    let error = state.error.lock().expect("backend error lock").clone();
    BackendStatus {
        ready: url.is_some(),
        url,
        error,
    }
}

#[tauri::command]
fn open_in_browser(app: AppHandle, state: State<'_, BackendState>) -> Result<(), String> {
    let url = state
        .url
        .lock()
        .map_err(|_| "Could not read backend URL".to_string())?
        .clone()
        .ok_or_else(|| "The dashboard is not ready yet.".to_string())?;
    app.opener()
        .open_url(url, None::<String>)
        .map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(BackendState::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![backend_status, open_in_browser])
        .setup(|app| {
            let handle = app.handle().clone();
            if let Err(error) = start_backend(handle.clone()) {
                let state = handle.state::<BackendState>();
                *state.error.lock().expect("backend error lock") = Some(error);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                let child = {
                    let state = window.state::<BackendState>();
                    state.child.lock().ok().and_then(|mut child| child.take())
                };
                if let Some(child) = child {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn start_backend(app: AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Could not create app data directory: {error}"))?;

    let backend_entry = app
        .path()
        .resolve("resources/backend/src/desktop-sidecar.js", BaseDirectory::Resource)
        .map_err(|error| format!("Could not resolve bundled backend: {error}"))?;

    let (mut rx, child) = app
        .shell()
        .sidecar("wacc-node")
        .map_err(|error| format!("Could not create backend sidecar command: {error}"))?
        .args([
            backend_entry.to_string_lossy().to_string(),
            "--data-dir".to_string(),
            app_data_dir.to_string_lossy().to_string(),
            "--host".to_string(),
            "127.0.0.1".to_string(),
            "--port".to_string(),
            "0".to_string(),
        ])
        .spawn()
        .map_err(|error| format!("Could not start backend sidecar: {error}"))?;

    let state = app.state::<BackendState>();
    *state.child.lock().expect("backend child lock") = Some(child);

    tauri::async_runtime::spawn(async move {
        let mut stdout_buffer = String::new();
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    stdout_buffer.push_str(&String::from_utf8_lossy(&bytes));
                    process_stdout_buffer(&app, &mut stdout_buffer);
                }
                CommandEvent::Stderr(bytes) => {
                    let text = String::from_utf8_lossy(&bytes).trim().to_string();
                    if !text.is_empty() {
                        println!("backend stderr: {text}");
                    }
                }
                CommandEvent::Error(error) => {
                    set_backend_error(&app, error);
                }
                CommandEvent::Terminated(payload) => {
                    if payload.code.unwrap_or_default() != 0 {
                        set_backend_error(&app, format!("Backend exited with status {:?}", payload.code));
                    }
                }
                _ => {}
            }
        }
    });

    Ok(())
}

fn process_stdout_buffer(app: &AppHandle, buffer: &mut String) {
    while let Some(index) = buffer.find('\n') {
        let line = buffer[..index].trim().to_string();
        *buffer = buffer[index + 1..].to_string();
        if line.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(&line) {
            match value.get("type").and_then(Value::as_str) {
                Some("ready") => {
                    if let Some(url) = value.get("url").and_then(Value::as_str) {
                        let state = app.state::<BackendState>();
                        *state.url.lock().expect("backend url lock") = Some(url.to_string());
                        *state.error.lock().expect("backend error lock") = None;
                        let _ = app.emit("backend-ready", url.to_string());
                    }
                }
                Some("error") => {
                    let message = value
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("Backend error")
                        .to_string();
                    set_backend_error(app, message);
                }
                _ => {}
            }
        } else {
            println!("backend stdout: {line}");
        }
    }
}

fn set_backend_error(app: &AppHandle, message: String) {
    let state = app.state::<BackendState>();
    *state.error.lock().expect("backend error lock") = Some(message.clone());
    let _ = app.emit("backend-error", message);
}
