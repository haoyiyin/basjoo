"""
数据库迁移脚本：添加 embedding_provider 字段

为 agents 表添加 embedding_provider 字段，支持独立的 embedding provider 选择（jina/siliconflow）。
"""

import sqlite3
import os
import shutil


def migrate():
    # 尝试多个可能的数据库路径
    possible_paths = [
        "/app/data/basjoo.db",  # Docker环境
        "./test.db",             # 本地开发环境
        "./data/basjoo.db",      # 本地开发环境
        "../data/basjoo.db",     # 本地开发环境
    ]

    db_path = None
    for path in possible_paths:
        if os.path.exists(path):
            db_path = path
            break

    if not db_path:
        print(f"数据库文件不存在，尝试的路径: {possible_paths}")
        return False

    print(f"开始迁移数据库: {db_path}")

    # 备份数据库
    backup_path = db_path + ".before_embedding_provider"
    shutil.copy2(db_path, backup_path)
    print(f"已备份数据库到: {backup_path}")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # 检查字段是否已存在
        cursor.execute("PRAGMA table_info(agents)")
        columns = [col[1] for col in cursor.fetchall()]

        if "embedding_provider" in columns:
            print("embedding_provider 字段已存在，跳过迁移")
            return True

        # 添加 embedding_provider 字段
        print("正在添加 embedding_provider 字段...")
        cursor.execute("""
            ALTER TABLE agents
            ADD COLUMN embedding_provider VARCHAR(20) DEFAULT 'jina'
        """)

        # 回填已有数据：provider_type 为 siliconflow 的 agent 设置为 siliconflow，其余保持默认 'jina'
        print("正在回填已有数据...")
        cursor.execute("""
            UPDATE agents
            SET embedding_provider = 'siliconflow'
            WHERE provider_type = 'siliconflow'
        """)

        conn.commit()
        print("✅ 迁移完成！")

        # 验证新字段
        cursor.execute("PRAGMA table_info(agents)")
        new_columns = [col[1] for col in cursor.fetchall()]
        if "embedding_provider" in new_columns:
            print("  ✓ embedding_provider 已添加")
        else:
            print("  ✗ embedding_provider 缺失！")

        return True

    except Exception as e:
        print(f"❌ 迁移失败: {e}")
        conn.rollback()
        shutil.copy2(backup_path, db_path)
        print(f"已从备份恢复数据库")
        return False

    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
