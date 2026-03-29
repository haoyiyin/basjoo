"""
数据库迁移脚本：为 agents 表添加 offline_reply 和错误状态字段
"""

import os
import sqlite3
import shutil


COLUMNS = [
    ("offline_reply", "TEXT"),
    ("last_error_code", "VARCHAR(50)"),
    ("last_error_message", "TEXT"),
    ("last_error_at", "DATETIME"),
]


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

    backup_path = db_path + ".before_offline_reply_and_error_status"
    shutil.copy2(db_path, backup_path)
    print(f"已备份数据库到: {backup_path}")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        cursor.execute("PRAGMA table_info(agents)")
        columns = [col[1] for col in cursor.fetchall()]

        added_columns = []
        for column_name, column_def in COLUMNS:
            if column_name in columns:
                print(f"{column_name} 字段已存在，跳过")
                continue

            print(f"  添加 {column_name}...")
            cursor.execute(
                f"""
                ALTER TABLE agents
                ADD COLUMN {column_name} {column_def}
                """
            )
            added_columns.append(column_name)

        if not added_columns:
            print("所有字段已存在，无需迁移")
            return True

        conn.commit()
        print("✅ 迁移完成！")

        cursor.execute("PRAGMA table_info(agents)")
        new_columns = [col[1] for col in cursor.fetchall()]
        for column_name, _ in COLUMNS:
            if column_name not in new_columns:
                raise RuntimeError(f"{column_name} 字段未成功添加")
            print(f"  ✓ {column_name} 已添加")

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
