//! PDF 导出（spec §9）：`PdfExporter` trait + macOS WKWebView 实现。
//! 输出保留可选择文字与可点击链接；10 秒超时不保留不完整文件。

use crate::infrastructure::errors::{AppError, AppResult};
use std::path::PathBuf;

pub struct PdfExportRequestMac {
    pub html: String,
    /// 模板目录（作为 baseURL，解析 assets/ 相对路径）
    pub base_dir: PathBuf,
    pub output_path: PathBuf,
    /// 模板 manifest 的 @page CSS，注入 <style>
    pub page_css: String,
}

pub struct PdfExportResultMac {
    pub output_path: PathBuf,
    pub page_count: u32,
    pub sha256: String,
}

pub trait PdfExporter: Send + Sync {
    fn export(
        &self,
        handle: &tauri::AppHandle,
        req: PdfExportRequestMac,
    ) -> AppResult<PdfExportResultMac>;
}

pub struct WkWebViewExporter;

impl PdfExporter for WkWebViewExporter {
    #[cfg(target_os = "macos")]
    fn export(
        &self,
        handle: &tauri::AppHandle,
        req: PdfExportRequestMac,
    ) -> AppResult<PdfExportResultMac> {
        macos::export_pdf(handle, req)
    }

    #[cfg(not(target_os = "macos"))]
    fn export(
        &self,
        _handle: &tauri::AppHandle,
        _req: PdfExportRequestMac,
    ) -> AppResult<PdfExportResultMac> {
        Err(AppError::Internal("当前平台尚未实现 PDF 导出".into()))
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{MainThreadMarker, MainThreadOnly};
    use objc2_foundation::{NSData, NSError, NSString, NSURL};
    use objc2_web_kit::{WKPDFConfiguration, WKWebView, WKWebViewConfiguration};
    use std::sync::mpsc;

    const TOTAL_TIMEOUT_SECS: u64 = 10;

    pub fn export_pdf(
        handle: &tauri::AppHandle,
        req: PdfExportRequestMac,
    ) -> AppResult<PdfExportResultMac> {
        let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();
        let out_path = req.output_path.clone();
        let html = crate::infrastructure::snapshot::inject_ready_marker(&format!(
            "<style>{}</style>\n{}",
            req.page_css, req.html
        ));

        let tx_main = tx.clone();
        handle
            .run_on_main_thread(move || {
                // 仅在主线程创建 WebKit 对象
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
                    objc2_foundation::NSSize::new(794.0, 1123.0), // A4 @96dpi
                );
                let webview = unsafe {
                    WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), frame, &config)
                };
                let base_url = NSURL::fileURLWithPath_isDirectory(
                    &NSString::from_str(&req.base_dir.to_string_lossy()),
                    true,
                );
                let _ = unsafe {
                    webview.loadHTMLString_baseURL(&NSString::from_str(&html), Some(&base_url))
                };
                poll_ready_then_create_pdf(webview, tx_main, 0);
            })
            .map_err(|e| AppError::Internal(format!("无法在主线程启动导出: {e}")))?;

        let result = rx
            .recv_timeout(std::time::Duration::from_secs(TOTAL_TIMEOUT_SECS))
            .map_err(|_| AppError::Internal("PDF 导出超时（10 秒）".into()))?;

        match result {
            Err(e) => Err(AppError::Internal(format!("PDF 导出失败: {e}"))),
            Ok(bytes) => {
                if bytes.is_empty() {
                    return Err(AppError::Internal("PDF 数据为空".into()));
                }
                crate::infrastructure::file_repo::atomic_write(&out_path, &bytes)?;
                let page_count = count_pdf_pages(&bytes).unwrap_or(1);
                Ok(PdfExportResultMac {
                    output_path: out_path,
                    page_count,
                    sha256: crate::infrastructure::file_repo::sha256_hex(&bytes),
                })
            }
        }
    }

    /// 页面就绪（标记 + complete + 字体）后调用 createPDF；否则继续探测。
    /// 旧空白上下文中脚本返回 "wait"，由重试兜底（修复空 PDF）。
    fn poll_ready_then_create_pdf(
        webview: Retained<WKWebView>,
        tx: mpsc::Sender<Result<Vec<u8>, String>>,
        attempt: usize,
    ) {
        use crate::infrastructure::snapshot::MAX_WAIT_ATTEMPTS;

        if attempt >= MAX_WAIT_ATTEMPTS {
            let _ = tx.send(Err("页面加载等待超时（未探测到就绪标记）".into()));
            return;
        }
        let Some(mtm) = MainThreadMarker::new() else {
            let _ = tx.send(Err("不在主线程".into()));
            return;
        };
        let body = NSString::from_str(crate::infrastructure::snapshot::WAIT_BODY);
        let world = unsafe { objc2_web_kit::WKContentWorld::pageWorld(mtm) };
        let tx2 = tx.clone();
        let w_handler = webview.clone();
        let handler = block2::RcBlock::new(
            move |result: *mut AnyObject, _err: *mut NSError| {
                let ready = unsafe {
                    (!result.is_null()).then(|| {
                        Retained::retain(result as *mut NSString)
                            .map(|s| s.to_string() == "ready")
                            .unwrap_or(false)
                    }) == Some(true)
                };
                if ready {
                    create_pdf(&w_handler, tx2.clone());
                } else {
                    poll_ready_then_create_pdf(w_handler.clone(), tx2.clone(), attempt + 1);
                }
            },
        );
        unsafe {
            webview.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                &body,
                None,
                None,
                &world,
                Some(&handler),
            );
        }
    }

    fn create_pdf(webview: &WKWebView, tx: mpsc::Sender<Result<Vec<u8>, String>>) {
        let mtm = MainThreadMarker::new();
        let pdf_config = mtm.map(|m| unsafe { WKPDFConfiguration::new(m) });
        let handler = block2::RcBlock::new(
            move |data: *mut NSData, err: *mut NSError| {
                if !data.is_null() {
                    unsafe {
                        let data = Retained::retain(data).unwrap();
                        let len = data.length() as usize;
                        let mut buf = vec![0u8; len];
                        if len > 0 {
                            data.getBytes_length(std::ptr::NonNull::new(buf.as_mut_ptr().cast()).unwrap(), len);
                        }
                        let _ = tx.send(Ok(buf));
                    }
                } else {
                    let msg = if err.is_null() {
                        "createPDF 失败".to_string()
                    } else {
                        unsafe { Retained::retain(err).map(|e| e.to_string()).unwrap_or_default() }
                    };
                    let _ = tx.send(Err(msg));
                }
            },
        );
        unsafe {
            let cfg: Option<&WKPDFConfiguration> = pdf_config.as_deref();
            webview.createPDFWithConfiguration_completionHandler(cfg, &handler);
        }
    }

    fn count_pdf_pages(bytes: &[u8]) -> Option<u32> {
        let s = String::from_utf8_lossy(bytes);
        let count = s.matches("/Type /Page").count().max(1);
        Some(count as u32)
    }
}
