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
            use objc2::{MainThreadMarker, MainThreadOnly};
            use objc2_foundation::{NSString, NSURL};
            use objc2_web_kit::{WKWebView, WKWebViewConfiguration};

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
            let marker_html = inject_ready_marker(&html);
            let _ = unsafe {
                webview.loadHTMLString_baseURL(&NSString::from_str(&marker_html), Some(&base_url))
            };

            wait_ready_then_snapshot(webview, tx_main, w, h, 0);
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

/// 就绪探测脚本：延迟 250ms 再判断（给导航提交留时间），只有当
/// readyState=complete、字体就绪、且页面上存在我们注入的标记时才返回
/// "ready"。在旧的空白上下文中执行时返回 "wait"，由 Rust 侧重试。
pub(crate) const WAIT_JS: &str = r#"new Promise(r => setTimeout(() => {
  const ok = document.readyState === 'complete'
    && (!document.fonts || document.fonts.status === 'loaded')
    && document.querySelector('meta[name="jsw-render"]');
  r(ok ? 'ready' : 'wait');
}, 250))"#;

/// 最大探测次数（约 40 × 250ms = 10s，与外层超时匹配）。
pub(crate) const MAX_WAIT_ATTEMPTS: usize = 40;

/// 注入就绪标记，用于区分"目标文档"与加载前的空白上下文。
pub(crate) fn inject_ready_marker(html: &str) -> String {
    const MARKER: &str = r#"<meta name="jsw-render" content="1">"#;
    if let Some(pos) = html.find("<head>") {
        let mut out = String::with_capacity(html.len() + MARKER.len());
        out.push_str(&html[..pos + 6]);
        out.push_str(MARKER);
        out.push_str(&html[pos + 6..]);
        out
    } else {
        format!("{MARKER}{html}")
    }
}

/// 轮询页面就绪后截屏；未就绪则重新探测（脚本自带 250ms 延迟）。
#[cfg(target_os = "macos")]
fn wait_ready_then_snapshot(
    webview: objc2::rc::Retained<objc2_web_kit::WKWebView>,
    tx: std::sync::mpsc::Sender<Result<Vec<u8>, String>>,
    w: f64,
    h: f64,
    attempt: usize,
) {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_foundation::NSError;

    if attempt >= MAX_WAIT_ATTEMPTS {
        let _ = tx.send(Err("页面加载等待超时（未探测到就绪标记）".into()));
        return;
    }
    let js = objc2_foundation::NSString::from_str(WAIT_JS);
    let wv = webview.clone();
    let handler = block2::RcBlock::new(
        move |result: *mut AnyObject, _err: *mut NSError| {
            let ready = unsafe {
                (!result.is_null()).then(|| {
                    Retained::retain(result as *mut objc2_foundation::NSString)
                        .map(|s| s.to_string() == "ready")
                        .unwrap_or(false)
                }) == Some(true)
            };
            if ready {
                take_snapshot(wv.clone(), tx.clone(), w, h);
            } else {
                wait_ready_then_snapshot(wv.clone(), tx.clone(), w, h, attempt + 1);
            }
        },
    );
    unsafe {
        webview.evaluateJavaScript_completionHandler(&js, Some(&handler));
    }
}

#[cfg(target_os = "macos")]
fn take_snapshot(
    webview: objc2::rc::Retained<objc2_web_kit::WKWebView>,
    tx: std::sync::mpsc::Sender<Result<Vec<u8>, String>>,
    w: f64,
    h: f64,
) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    use objc2_foundation::NSDictionary;
    use objc2_web_kit::WKSnapshotConfiguration;

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
