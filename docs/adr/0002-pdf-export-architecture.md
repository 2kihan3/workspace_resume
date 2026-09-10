# ADR-0002：PDF 导出由前端渲染、Rust WKWebView 执行

状态：已接受（2026-09-11）

## 背景

方案 §9 要求 macOS 用隐藏 WKWebView `createPDF` 导出可选中文字、可点击链接的 PDF，
且 `PdfExporter` 在 Rust 层定义 trait。模板渲染引擎（Handlebars strict）位于 TS 侧。

## 决策

- 拆分为两个命令：
  - `read_template_assets` 返回模板 HTML/CSS；
  - `export_pdf_rendered` 接收前端用 `@jsw/template-engine` 渲染好的最终 HTML 与
    `@page` CSS，由 Rust `WkWebViewExporter`（`infrastructure/pdf.rs`）执行导出。
- WKWebView 仅在主线程创建（`MainThreadMarker`）；导出流程用
  `evaluateJavaScript(document.fonts.ready…)` 轮询等待字体与图片就绪后调用
  `createPDFWithConfiguration:completionHandler:`，全程不阻塞主线程。
- 调用方在独立线程等待结果，总超时 10 秒；失败不落盘。
- 页数通过对 PDF 数据中 `/Type /Page` 计数估算，`sha256` 写入返回值。

## 影响

- Windows/Linux 后续只需替换 trait 实现，前端接口不变。
- 模板渲染与安全校验（strict mode、sanitizer）复用 TS 包，Rust 不引入 Handlebars。
