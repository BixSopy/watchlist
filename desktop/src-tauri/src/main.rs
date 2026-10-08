// Point d'entree : le shell natif se contente d'afficher la fenetre pointee sur
// l'app web en production (https://cinepisode.com, baseUrl de brand.config.json). Aucune
// logique metier ni aucun texte d'interface ici : tout reste dans index.html/js/*.js,
// deployes normalement sur Vercel. La langue (francais/anglais) est donc celle de l'app web :
// choix enregistre, sinon langue du systeme (WebView2).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_updater::UpdaterExt;
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Ok(updater) = handle.updater() {
                        if let Ok(Some(update)) = updater.check().await {
                            if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
                                handle.restart();
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .plugin(tauri_plugin_updater::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("Cinepisode failed to start");
}
