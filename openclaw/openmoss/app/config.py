"""
OpenMOSS 任务调度中间件 — 配置加载模块
"""
import os
import bcrypt
import yaml
from pathlib import Path
from typing import Optional


class AppConfig:
    """应用配置"""

    def __init__(self, config_path: str = "config.yaml"):
        self.config_path = Path(config_path)
        self._data = {}
        self.load()

    def load(self):
        """加载配置文件"""
        if not self.config_path.exists():
            # 如果没有 config.yaml，从模板复制
            example_path = Path("config.example.yaml")
            if example_path.exists():
                import shutil
                shutil.copy(example_path, self.config_path)
                print(f"[Config] 已从 {example_path} 创建配置文件 {self.config_path}")
            else:
                raise FileNotFoundError(
                    f"配置文件 {self.config_path} 不存在，请从 config.example.yaml 复制"
                )

        with open(self.config_path, "r", encoding="utf-8") as f:
            self._data = yaml.safe_load(f) or {}

        # 启动时自动加密管理员密码
        self._auto_encrypt_password()

    def _auto_encrypt_password(self):
        """如果密码是明文或旧的 MD5 格式，自动升级为 bcrypt 并回写配置文件"""
        admin = self._data.get("admin", {})
        password = str(admin.get("password", ""))

        if not password:
            return

        if password.startswith("bcrypt:"):
            # 已经是 bcrypt 格式，无需处理
            return

        if password.startswith("md5:"):
            # 旧的 MD5 格式，无法反向解密，需要用户重新设置密码
            # 使用默认密码 admin123 重新加密
            print(f"[Config] ⚠️ 检测到旧的 MD5 密码格式，自动升级为 bcrypt（使用默认密码 admin123）")
            print(f"[Config] ⚠️ 请登录后立即修改管理员密码！")
            raw_password = "admin123"
        else:
            # 明文密码
            raw_password = password

        # 用 bcrypt 加密
        hashed = bcrypt.hashpw(raw_password.encode(), bcrypt.gensalt()).decode()
        admin["password"] = f"bcrypt:{hashed}"
        self._data["admin"] = admin

        # 回写配置文件
        with open(self.config_path, "w", encoding="utf-8") as f:
            yaml.dump(self._data, f, allow_unicode=True, default_flow_style=False)

        print(f"[Config] 管理员密码已加密为 bcrypt")

    def verify_admin_password(self, password: str) -> bool:
        """验证管理员密码"""
        stored = self._data.get("admin", {}).get("password", "")

        if stored.startswith("bcrypt:"):
            bcrypt_hash = stored[7:]  # 去掉 "bcrypt:" 前缀
            return bcrypt.checkpw(password.encode(), bcrypt_hash.encode())

        # 兜底：不应出现，但防御性处理
        return False

    @property
    def server_port(self) -> int:
        return self._data.get("server", {}).get("port", 6565)

    @property
    def server_host(self) -> str:
        return self._data.get("server", {}).get("host", "0.0.0.0")

    @property
    def database_path(self) -> str:
        return self._data.get("database", {}).get("path", "./data/tasks.db")

    @property
    def database_type(self) -> str:
        return self._data.get("database", {}).get("type", "sqlite")

    @property
    def registration_token(self) -> str:
        return self._data.get("agent", {}).get("registration_token", "")

    @property
    def allow_registration(self) -> bool:
        """Agent 自注册开关，默认开启"""
        return self._data.get("agent", {}).get("allow_registration", True)

    @property
    def workspace_root(self) -> str:
        return self._data.get("workspace", {}).get("root", "./workspace")

    @property
    def project_name(self) -> str:
        return self._data.get("project", {}).get("name", "OpenMOSS")

    @property
    def notification_config(self) -> dict:
        return self._data.get("notification", {})

    @property
    def public_feed_enabled(self) -> bool:
        """活动流展示页是否公开"""
        return self._data.get("webui", {}).get("public_feed", False)

    @property
    def feed_retention_days(self) -> int:
        """请求日志保留天数"""
        return self._data.get("webui", {}).get("feed_retention_days", 7)

    @property
    def raw(self) -> dict:
        """获取原始配置数据"""
        return self._data


# 全局配置实例
config = AppConfig()
