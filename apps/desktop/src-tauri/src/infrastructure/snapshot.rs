//! 模板静态预览图生成（spec §8.3）：WKWebView `takeSnapshot` + NSImage → PNG。
//! 复用 PDF 导出的主线程与 fonts.ready 等待模式（ADR-0002）。

use crate::infrastructure::errors::{AppError, AppResult};
use std::path::PathBuf;

pub struct SnapshotRequest {
    pub html: String,
    /// 模板目录（baseURL，解析 style.css 与 assets/ 相对路径）
    pub base_dir: PathBuf,
    /// 快照区域像素宽（A4 @96dpi）
    pub width: f64,
    pub height: f64,
}

#[cfg(target_os = "macos")]
pub fn snapshot_png(
    handle: &tauri::AppHandle,
    req: SnapshotRequest,
) -> AppResult<Vec<u8>> {
    use std::sync::mpsc;

    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
    let html = req.html;
    let base_dir = req.base_dir;
    let (w, h) = (req.width, req.height);

    let tx_main = tx.clone();
    handle
        .run_on_main_thread(move || {
            use objc2::rc::Retained;
            use objc2::runtime::AnyObject;
            use objc2::{MainThreadMarker, MainThreadOnly};
            use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
            use objc2_foundation::{NSData, NSDictionary, NSError, NSString, NSURL};
            use objc2_web_kit::{
                WKSnapshotConfiguration, WKWebView, WKWebViewConfiguration,
            };

            let mtm = match MainThreadMarker::new() {
                Some(m) => m,
                None => {
                    let _ = tx_main.send(Err("不在主线程".into()));
                    return;
                }
            };
            let config = unsafe { WKWebViewConfiguration::new(mtm) };
            let frame = objc2_foundation::NSRect::new(
                objc2_foundation::NSPoint::new(0.0, 0.0),
                objc2_foundation::NSSize::new(w, h),
            );
            let webview = unsafe {
                WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), frame, &config)
            };
            let base_url = NSURL::fileURLWithPath_isDirectory(
                &NSString::from_str(&base_dir.to_string_lossy()),
                true,
            );
            let _ = unsafe {
                webview.loadHTMLString_baseURL(&NSString::from_str(&html), Some(&base_url))
            };

            // fonts.ready 后截屏
            let js = NSString::from_str("document.fonts.ready.then(() => 'fonts-done')");
            let w2 = webview.clone();
            let handler = block2::RcBlock::new(
                move |result: *mut AnyObject, _err: *mut NSError| {
                    let done = unsafe {
                        (!result.is_null()).then(|| {
                            Retained::retain(result as *mut NSString)
                                .map(|s| s.to_string() == "fonts-done")
                                .unwrap_or(false)
                        }) == Some(true)
                    };
                    let _ = done;
                    take_snapshot(&w2, tx_main.clone(), w, h, 0);
                },
            );
            unsafe {
                webview.evaluateJavaScript_completionHandler(&js, Some(&handler));
            }
        })
        .map_err(|e| AppError::Internal(format!("无法在主线程启动快照: {e}")))?;

    let result = rx
        .recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|_| AppError::Internal("预览图生成超时（10 秒）".into()))?;

    match result {
        Err(e) => Err(AppError::Internal(format!("预览图生成失败: {e}"))),
        Ok(bytes) => {
            if bytes.is_empty() {
                return Err(AppError::Internal("预览图数据为空".into()));
            }
            Ok(bytes)
        }
    }
}

#[cfg(target_os = "macos")]
fn take_snapshot(
    webview: &objc2_web_kit::WKWebView,
    tx: std::sync::mpsc::Sender<Result<Vec<u8>, String>>,
    w: f64,
    h: f64,
    attempt: usize,
) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    use objc2_foundation::NSDictionary;
    use objc2_web_kit::WKSnapshotConfiguration;

    if attempt >= 20 {
        let _ = tx.send(Err("页面加载等待超时".into()));
        return;
    }
    let mtm = MainThreadMarker::new();
    let Some(mtm) = mtm else {
        let _ = tx.send(Err("不在主线程".into()));
        return;
    };
    let config = unsafe { WKSnapshotConfiguration::new(mtm) };
    unsafe {
        config.setRect(objc2_foundation::NSRect::new(
            objc2_foundation::NSPoint::new(0.0, 0.0),
            objc2_foundation::NSSize::new(w, h),
        ));
    }
    let tx2 = tx.clone();
    let handler = block2::RcBlock::new(
        move |image: *mut objc2_app_kit::NSImage, err: *mut objc2_foundation::NSError| {
            if image.is_null() {
                let msg = if err.is_null() {
                    "takeSnapshot 失败".to_string()
                } else {
                    unsafe {
                        objc2::rc::Retained::retain(err)
                            .map(|e| e.to_string())
                            .unwrap_or_default()
                    }
                };
                let _ = tx2.send(Err(msg));
                return;
            }
            // NSImage -> TIFF -> NSBitmapImageRep -> PNG
            let png = (|| -> Option<Vec<u8>> {
                let image = unsafe { objc2::rc::Retained::retain(image)? };
                let tiff = image.TIFFRepresentation()?;
                let rep = NSBitmapImageRep::imageRepWithData(&tiff)?;
                let props = NSDictionary::new();
                let data = unsafe {
                    rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &props)
                }?;
                let len = data.length() as usize;
                let mut buf = vec![0u8; len];
                if len > 0 {
                    let ptr = std::ptr::NonNull::new(buf.as_mut_ptr().cast()).unwrap();
                    unsafe { data.getBytes_length(ptr, len) };
                }
                Some(buf)
            })();
            match png {
                Some(bytes) => {
                    let _ = tx2.send(Ok(bytes));
                }
                None => {
                    let _ = tx2.send(Err("NSImage 转 PNG 失败".into()));
                }
            }
        },
    );
    unsafe {
        webview.takeSnapshotWithConfiguration_completionHandler(Some(&config), &handler);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn snapshot_png(
    _handle: &tauri::AppHandle,
    _req: SnapshotRequest,
) -> AppResult<Vec<u8>> {
    Err(AppError::Internal("当前平台尚未实现预览图生成".into()))
}
