"""
数据库迁移脚本：为 agents 表添加 reasoning_effort 字段
"""

import os
import sqlite3
import shutil


ALLOWED_VALUES = {"low", "medium", "high"}


def migrate():
    possible_paths = [
        "/app/data/basjoo.db",  # Docker环境
        "./test.db",            # 本地开发环境
        "./data/basjoo.db",     # 本地开发环境
        "../data/basjoo.db",    # 本地开发环境
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

    backup_path = db_path + ".before_reasoning_effort"
    shutil.copy2(db_path, backup_path)
    print(f"已备份数据库到: {backup_path}")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        cursor.execute("PRAGMA table_info(agents)")
        columns = [col[1] for col in cursor.fetchall()]

        if "reasoning_effort" in columns:
            print("reasoning_effort 字段已存在，跳过迁移")
            return True

        print("  添加 reasoning_effort...")
        cursor.execute(
            """
            ALTER TABLE agents
            ADD COLUMN reasoning_effort VARCHAR(20)
            CHECK (reasoning_effort IN ('low', 'medium', 'high') OR reasoning_effort IS NULL)
            """
        )

        conn.commit()
        print("✅ 迁移完成！")

        cursor.execute("PRAGMA table_info(agents)")
        new_columns = [col[1] for col in cursor.fetchall()]
        if "reasoning_effort" not in new_columns:
            raise RuntimeError("reasoning_effort 字段未成功添加")

        cursor.execute(
            "SELECT DISTINCT reasoning_effort FROM agents WHERE reasoning_effort IS NOT NULL"
        )
        existing_values = {row[0] for row in cursor.fetchall()}
        invalid_values = existing_values - ALLOWED_VALUES
        if invalid_values:
            raise RuntimeError(f"发现非法 reasoning_effort 值: {sorted(invalid_values)}")

        print("  ✓ reasoning_effort 已添加")
        return True

    except Exception as e:
        print(f"❌ 迁移失败: {e}")
        conn.rollback()
        shutil.copy2(backup_path, db_path)
        print("已从备份恢复数据库")
        return False

    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
