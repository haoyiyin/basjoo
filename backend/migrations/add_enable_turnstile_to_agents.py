"""
数据库迁移脚本：为 agents 表添加 enable_turnstile 字段
"""

import os
import sqlite3
import shutil


COLUMN_NAME = "enable_turnstile"
COLUMN_DEF = "BOOLEAN NOT NULL DEFAULT 0"


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

    backup_path = db_path + ".before_enable_turnstile"
    shutil.copy2(db_path, backup_path)
    print(f"已备份数据库到: {backup_path}")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        cursor.execute("PRAGMA table_info(agents)")
        columns = [col[1] for col in cursor.fetchall()]

        if COLUMN_NAME in columns:
            print("enable_turnstile 字段已存在，跳过迁移")
            return True

        print("  添加 enable_turnstile...")
        cursor.execute(
            f"""
            ALTER TABLE agents
            ADD COLUMN {COLUMN_NAME} {COLUMN_DEF}
            """
        )

        conn.commit()
        print("✅ 迁移完成！")

        cursor.execute("PRAGMA table_info(agents)")
        new_columns = [col[1] for col in cursor.fetchall()]
        if COLUMN_NAME not in new_columns:
            raise RuntimeError("enable_turnstile 字段未成功添加")

        print("  ✓ enable_turnstile 已添加")
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
