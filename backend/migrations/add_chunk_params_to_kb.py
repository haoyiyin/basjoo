"""数据库迁移脚本：为 knowledge_bases 表添加 chunk_size/chunk_overlap 字段，为 kb_documents 表添加 error_message/file_size 字段。

幂等迁移，支持多租户知识库的文档解析流水线。
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
    backup = db_path + ".before_chunk_params"
    shutil.copy2(db_path, backup)

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    try:
        # knowledge_bases: chunk_size, chunk_overlap
        cursor.execute("PRAGMA table_info(knowledge_bases)")
        kb_cols = [c[1] for c in cursor.fetchall()]

        if "chunk_size" not in kb_cols:
            print("添加 chunk_size 字段...")
            cursor.execute(
                "ALTER TABLE knowledge_bases ADD COLUMN chunk_size INTEGER NOT NULL DEFAULT 512"
            )
        else:
            print("chunk_size 已存在，跳过")

        if "chunk_overlap" not in kb_cols:
            print("添加 chunk_overlap 字段...")
            cursor.execute(
                "ALTER TABLE knowledge_bases ADD COLUMN chunk_overlap INTEGER NOT NULL DEFAULT 64"
            )
        else:
            print("chunk_overlap 已存在，跳过")

        # kb_documents: error_message, file_size
        cursor.execute("PRAGMA table_info(kb_documents)")
        doc_cols = [c[1] for c in cursor.fetchall()]

        if "error_message" not in doc_cols:
            print("添加 error_message 字段...")
            cursor.execute("ALTER TABLE kb_documents ADD COLUMN error_message TEXT")
        else:
            print("error_message 已存在，跳过")

        if "file_size" not in doc_cols:
            print("添加 file_size 字段...")
            cursor.execute("ALTER TABLE kb_documents ADD COLUMN file_size INTEGER")
        else:
            print("file_size 已存在，跳过")

        conn.commit()
        print("✅ chunk_params 迁移完成")
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
