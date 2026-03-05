# 跨平台适配修复计划

> 状态: ✅ 代码修复完成 (oracle 二轮审查通过) | 剩余: CI 矩阵 + prepare-win-deps.sh 加固

## 批次 1: 构建基础 (阻塞发布)

### 1.1 补齐 sidecar 二进制 + build.rs 安全断言

**问题**: 仅有 `vm-agent-aarch64-apple-darwin`, 缺少 x86_64-apple-darwin 和 x86_64-pc-windows-msvc.exe

**修复 `build.rs`**:
```rust
fn main() {
    let target = std::env::var("TARGET").unwrap_or_default();
    println!("cargo:rustc-env=TARGET_TRIPLE={}", target);

    let ext = if target.contains("windows") { ".exe" } else { "" };
    let sidecar_path = format!("binaries/vm-agent-{}{}", target, ext);

    // Release 构建必须有真实 sidecar
    let profile = std::env::var("PROFILE").unwrap_or_default();
    if profile == "release" && !std::path::Path::new(&sidecar_path).exists() {
        panic!(
            "❌ Release build requires real sidecar binary: {}\n\
             Run the appropriate build command for target '{}'",
            sidecar_path, target
        );
    }

    // Dev: 仅在没有时创建占位符
    if !std::path::Path::new(&sidecar_path).exists() {
        std::fs::create_dir_all("binaries").ok();
        std::fs::write(&sidecar_path, "#!/bin/sh\necho 'dev placeholder'").ok();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(
                &sidecar_path,
                std::fs::Permissions::from_mode(0o755),
            ).ok();
        }
    }

    std::fs::create_dir_all("resources/pi-meta").ok();
    std::fs::create_dir_all("resources/win-bash/usr/bin").ok();
    std::fs::create_dir_all("resources/win-bin").ok();

    tauri_build::build()
}
```

**CI 构建矩阵** (`.github/workflows/release-desktop.yml`):
```yaml
strategy:
  matrix:
    include:
      - os: macos-latest    # arm64
        target: aarch64-apple-darwin
      - os: macos-13        # x86_64
        target: x86_64-apple-darwin
      - os: windows-latest
        target: x86_64-pc-windows-msvc
```

每个 job 先编译 vm-agent sidecar:
```bash
# macOS arm64
cd vm-agent && bun build --compile --target=bun-darwin-arm64 src/index.ts --outfile ../desktop/src-tauri/binaries/vm-agent-aarch64-apple-darwin

# macOS x86_64
cd vm-agent && bun build --compile --target=bun-darwin-x64 src/index.ts --outfile ../desktop/src-tauri/binaries/vm-agent-x86_64-apple-darwin

# Windows x86_64
cd vm-agent && bun build --compile --target=bun-windows-x64 src/index.ts --outfile ../desktop/src-tauri/binaries/vm-agent-x86_64-pc-windows-msvc.exe
```

### 1.2 Dev 模式优先使用 JS fallback

**修复 `sidecar.rs::start_agent()`** — `find_sidecar_binary()` 返回前检测占位符:
```rust
fn find_sidecar_binary() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;

    let triple = env!("TARGET_TRIPLE");
    let candidates = if cfg!(windows) {
        vec![format!("vm-agent-{}.exe", triple), "vm-agent.exe".to_string()]
    } else {
        vec![format!("vm-agent-{}", triple), "vm-agent".to_string()]
    };

    for name in candidates {
        let path = dir.join(&name);
        if path.exists() {
            // 跳过 dev 占位符 (< 1KB 的肯定不是真实二进制)
            if let Ok(meta) = path.metadata() {
                if meta.len() < 1024 {
                    continue;
                }
            }
            return Some(path);
        }
    }
    None
}
```

---

## 批次 2: 路径处理 (Windows 核心)

### 2.1 添加 dunce 依赖, 替换 canonicalize

**修复 `Cargo.toml`**: 添加 `dunce = "1"`

**修复 `lib.rs`** — 创建统一 helper:
```rust
/// Windows-safe canonicalize: 去掉 \\?\ 前缀
fn safe_canonicalize(path: &Path) -> std::io::Result<PathBuf> {
    dunce::canonicalize(path)
}
```

然后全局替换:
- `path.canonicalize()` → `safe_canonicalize(path)`
- `std::fs::canonicalize(...)` → `dunce::canonicalize(...)`

涉及文件:
- `lib.rs`: `validate_resolved_path`, `resolve_read_path`, `resolve_path`
- `sidecar.rs`: `resolve_agent_paths`, `delete_user_skill`

### 2.2 统一 Rust → Agent 的目录传递

**修复 `sidecar.rs::start_agent()`** — 补传 MEMORY_ROOT_DIR:
```rust
// 在 cmd.env("MEMORY_ENABLED", "true") 之前添加:
let memory_root = app.path().app_data_dir()
    .map(|dir| dir.join("memory"))
    .unwrap_or_default();
if !memory_root.as_os_str().is_empty() {
    std::fs::create_dir_all(&memory_root).ok();
    cmd.env("MEMORY_ROOT_DIR", memory_root.to_string_lossy().as_ref());
}
```

### 2.3 修复 agent.ts 的 import.meta.url 路径

**修复 `vm-agent/src/agent.ts:279`**:
```typescript
// Before:
const vmAgentRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");

// After:
import { fileURLToPath } from "node:url";
const vmAgentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
```

### 2.4 import_files 清理文件名

**修复 `lib.rs::import_files`** — 在 `for file in &files` 内添加:
```rust
// 清理文件名: 去除路径分隔符, 防止路径穿越
let safe_name = file.name
    .replace(['/', '\\'], "_")
    .trim_start_matches('.')
    .to_string();
let safe_name = if safe_name.is_empty() { "unnamed".to_string() } else { safe_name };
// 后续用 safe_name 替代 file.name
```

---

## 批次 3: 文件预览 (Windows 兼容)

### 3.1 asset protocol → Rust 后端 serve

**方案**: 新增 `read_file_base64` Tauri command, 前端改用 data URL

**新增 `lib.rs`**:
```rust
#[tauri::command]
fn read_file_base64(path: String, workspace: Option<String>, max_mb: Option<u32>) -> Result<String, String> {
    let full = resolve_read_path(&path, workspace.as_deref())?;
    let limit = (max_mb.unwrap_or(20) as u64) * 1024 * 1024;
    let meta = std::fs::metadata(&full).map_err(|e| format!("Cannot access: {}", e))?;
    if meta.len() > limit {
        return Err(format!("File too large: {} bytes (limit {}MB)", meta.len(), limit / (1024*1024)));
    }
    let bytes = std::fs::read(&full).map_err(|e| format!("Read error: {}", e))?;
    let ext = full.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let mime = ext_to_mime(&ext);
    Ok(format!("data:{};base64,{}", mime, base64::engine::general_purpose::STANDARD.encode(&bytes)))
}
```

**前端改造** (`Markdown.tsx`, `PreviewDrawer.tsx`):
```typescript
// Before:
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
assetUrl = convertFileSrc(resolved);

// After:
assetUrl = await invoke<string>("read_file_base64", {
  path: filePath,
  workspace: workspacePath || null,
});
```

注意: 大文件 (视频/PDF) 仍用 `preview_file` 已有的 base64 通道, 图片用新 command。

---

## 批次 4: 进程管理

### 4.1 进程树清理

**修复 `sidecar.rs::stop_agent()`**:
```rust
#[tauri::command]
pub fn stop_agent() -> Result<(), String> {
    let mut proc = AGENT_PROCESS.lock().unwrap();
    if let Some(process) = proc.as_mut() {
        kill_process_tree(&mut process.child);
    }
    *proc = None;
    Ok(())
}

fn kill_process_tree(child: &mut Child) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // 尝试 killpg, 失败则 kill 单进程
        if let Some(pid) = child.id() {
            unsafe { libc::killpg(pid as i32, libc::SIGTERM); }
            std::thread::sleep(Duration::from_millis(200));
            unsafe { libc::killpg(pid as i32, libc::SIGKILL); }
        }
    }
    #[cfg(windows)]
    {
        if let Some(pid) = child.id() {
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .status();
        }
    }
    // Fallback: 直接 kill
    let _ = child.kill();
    let _ = child.wait();
}
```

注意: Unix 侧需要 `libc` 依赖, 或者改用 `nix` crate。简化方案是用 `sysinfo` crate 按 parent PID 遍历。

### 4.2 Tauri exit hook

**修复 `lib.rs::run()`**:
```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|_app| { /* ... existing devtools code ... */ Ok(()) })
        .invoke_handler(tauri::generate_handler![ /* ... */ ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                let _ = sidecar::stop_agent();
            }
        });
}
```

注意: `.run()` 替换原来的链式 `.run(...)`, 需要先 `.build()` 再 `.run(callback)`。

---

## 批次 5: Windows 环境加固

### 5.1 MSYS 环境变量

**修复 `sidecar.rs` 的 `#[cfg(windows)]` 块**, 在 `cmd.env("MSYS2_PATH_TYPE", "inherit")` 后添加:
```rust
// 阻止 MSYS 自动转换 Windows 路径参数
cmd.env("MSYS2_ARG_CONV_EXCL", "*");
// 强制 UTF-8 输出
cmd.env("LANG", "C.UTF-8");
cmd.env("LC_ALL", "C.UTF-8");
```

### 5.2 PowerShell UTF-8 输出

**修复 `vm-agent/src/tools/powershell.ts:97-98`**:
```typescript
// Before:
const args = ["-NoProfile", "-NonInteractive", "-Command", params.command];

// After:
const utf8Preamble = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; ";
const args = [
  "-NoProfile", "-NonInteractive",
  "-Command", utf8Preamble + params.command,
];
```

### 5.3 prepare-win-deps.sh 加固

1. 添加 `unzip` 预检
2. 添加 SHA256 校验
3. 补全 DLL 列表 (添加 `msys-readline8.dll`, `msys-ncursesw6.dll`, `msys-z.dll`)

---

## 批次 6: 配置优化 (非阻塞)

### 6.1 按平台条件化 resources 打包

**修复 `tauri.conf.json`** — 暂无原生支持, 可在 CI 中用脚本按平台修改 json:
```bash
# macOS CI: 移除 win-bash/win-bin
jq 'del(.bundle.resources["resources/win-bash"], .bundle.resources["resources/win-bin"])' tauri.conf.json > tmp && mv tmp tauri.conf.json
```

### 6.2 macOS Entitlements 可能需要 disable-library-validation

如果公证后 bun-compiled sidecar 签名验证失败:
```xml
<key>com.apple.security.cs.disable-library-validation</key>
<true/>
```

### 6.3 vm-agent resolveSkillsPaths 容器 fallback 保护

```typescript
function resolveSkillsPaths(envVal?: string): string[] {
  if (envVal) {
    return envVal.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const currentFile = fileURLToPath(import.meta.url);
  const vmAgentRoot = resolve(dirname(currentFile), "..");
  const defaultPaths = [join(vmAgentRoot, "skills")];
  // 容器 fallback 仅在 Linux 上添加
  if (process.platform === "linux") {
    defaultPaths.push("/shared/skills");
  }
  return defaultPaths;
}
```

---

## 验证清单

- [ ] macOS arm64: `make dev-desktop` 启动, 对话正常
- [ ] macOS x86_64: CI 构建产出包含真实 sidecar
- [ ] Windows x86_64: CI 构建产出包含 `.exe` sidecar
- [ ] Windows 中文用户名 (`C:\Users\张三\`): sidecar 启动正常
- [ ] Windows D:\ 工作区: 文件预览正常
- [ ] 进程退出: 关闭应用后无残留 agent/bash 进程
- [ ] `build.rs`: release 模式缺 sidecar 会 panic
- [ ] memory 路径: Rust 和 agent 指向同一目录
