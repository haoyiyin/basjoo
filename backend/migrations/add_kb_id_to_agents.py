"""
数据库迁移脚本：为 agents 表添加 kb_id 字段（知识库关联）

支持多租户独立知识库架构，kb_id 关联 knowledge_bases.id。
"""

import os
import shutil
import sqlite3


def migrate():
    possible_paths = [
        "/app/data/basjoo.db",
        "./test.db",
        "./data/basjoo.db",
        "../data/basjoo.db",
    ]
    db_path = next((p for p in possible_paths if os.path.exists(p)), None)
    if not db_path:
        print("数据库文件不存在，跳过（新部署由 create_all 处理）")
        return True

    print(f"开始迁移: {db_path}")
    backup = db_path + ".before_kb_id"
    shutil.copy2(db_path, backup)

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    try:
        cursor.execute("PRAGMA table_info(agents)")
        cols = [c[1] for c in cursor.fetchall()]
        if "kb_id" in cols:
            print("kb_id 字段已存在，跳过")
            return True

        print("添加 kb_id 字段...")
        cursor.execute("ALTER TABLE agents ADD COLUMN kb_id VARCHAR(36)")
        # 可选索引
        cursor.execute("CREATE INDEX IF NOT EXISTS ix_agents_kb_id ON agents(kb_id)")
        conn.commit()
        print("✅ kb_id 迁移完成")
        return True
    except Exception as e:
        print(f"❌ 失败: {e}")
        conn.rollback()
        shutil.copy2(backup, db_path)
        return False
    finally:
        conn.close()


if __name__ == "__main__":
    migrate()
