#!/usr/bin/env python3
"""
生成加密密钥的辅助脚本

使用方法:
    python generate_encryption_key.py

此脚本会生成一个适合用于 ENCRYPTION_KEY 环境变量的密钥。
"""

import secrets
import base64


def generate_encryption_key() -> str:
    """生成一个安全的加密密钥"""
    # 生成 32 字节的随机密钥
    key_bytes = secrets.token_bytes(32)
    # 转换为 base64 便于存储
    key_b64 = base64.urlsafe_b64encode(key_bytes).decode('utf-8')
    return key_b64


def main():
    print("=" * 60)
    print("Basjoo API Key 加密密钥生成器")
    print("=" * 60)
    print()

    key = generate_encryption_key()

    print("生成的加密密钥:")
    print("-" * 60)
    print(key)
    print("-" * 60)
    print()
    print("使用方法:")
    print("1. 将上述密钥添加到 .env 文件:")
    print(f"   ENCRYPTION_KEY={key}")
    print()
    print("2. 或者在启动服务器时设置环境变量:")
    print(f"   export ENCRYPTION_KEY={key}")
    print()
    print("⚠️  重要安全提示:")
    print("   - 请妥善保管此密钥，丢失后将无法解密已存储的 API Key")
    print("   - 生产环境请使用不同的密钥")
    print("   - 不要将此密钥提交到版本控制")
    print()


if __name__ == "__main__":
    main()
