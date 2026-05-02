"""
数据库迁移脚本：添加 siliconflow_api_key 字段

为 agents 表添加 siliconflow_api_key 字段，支持独立的 SiliconFlow Embedding API Key。
"""

import sqlite3
import os
import shutil


def migrate():
    possible_paths = [
        "/app/data/basjoo.db",
        "./test.db",
        "./data/basjoo.db",
        "../data/basjoo.db",
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

    backup_path = db_path + ".before_siliconflow_api_key"
    shutil.copy2(db_path, backup_path)
    print(f"已备份数据库到: {backup_path}")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        cursor.execute("PRAGMA table_info(agents)")
        columns = [col[1] for col in cursor.fetchall()]

        if "siliconflow_api_key" in columns:
            print("siliconflow_api_key 字段已存在，跳过迁移")
            return True

        print("正在添加 siliconflow_api_key 字段...")
        cursor.execute("""
            ALTER TABLE agents
            ADD COLUMN siliconflow_api_key VARCHAR(500) DEFAULT ''
        """)

        conn.commit()
        print("✅ 迁移完成！")

        cursor.execute("PRAGMA table_info(agents)")
        new_columns = [col[1] for col in cursor.fetchall()]
        if "siliconflow_api_key" in new_columns:
            print("  ✓ siliconflow_api_key 已添加")
        else:
            print("  ✗ siliconflow_api_key 缺失！")

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
