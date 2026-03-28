"""
数据库迁移脚本：添加 Jina API Key 字段
"""

import sqlite3
import os


def migrate():
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

    backup_path = db_path + ".before_jina_api_key"
    import shutil
    shutil.copy2(db_path, backup_path)
    print(f"已备份数据库到: {backup_path}")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        cursor.execute("PRAGMA table_info(agents)")
        columns = [col[1] for col in cursor.fetchall()]

        if "jina_api_key" in columns:
            print("jina_api_key 字段已存在，跳过迁移")
            return True

        print("  添加 jina_api_key...")
        cursor.execute("""
            ALTER TABLE agents
            ADD COLUMN jina_api_key VARCHAR(500)
        """)

        conn.commit()
        print("✅ 迁移完成！")
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
