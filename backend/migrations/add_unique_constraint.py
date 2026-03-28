"""
数据库迁移脚本：添加URL唯一约束

这个脚本为现有的url_sources表添加唯一约束，防止并发创建重复的URL。
"""

import sqlite3
import os

def migrate():
    db_path = "/app/data/basjoo.db"

    if not os.path.exists(db_path):
        print(f"数据库文件不存在: {db_path}")
        return False

    print(f"开始迁移数据库: {db_path}")

    # 备份数据库
    backup_path = db_path + ".before_unique_constraint"
    import shutil
    shutil.copy2(db_path, backup_path)
    print(f"已备份数据库到: {backup_path}")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # 1. 检查是否已有唯一约束
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='index' AND name='uq_agent_normalized_url'")
        existing = cursor.fetchone()

        if existing:
            print("唯一约束已存在，跳过迁移")
            return True

        # 2. 删除重复的URL（保留最早的记录）
        print("正在清理重复的URL...")
        cursor.execute("""
            DELETE FROM url_sources
            WHERE id NOT IN (
                SELECT MIN(id)
                FROM url_sources
                GROUP BY agent_id, normalized_url
            )
        """)
        deleted_count = cursor.rowcount
        print(f"  删除了 {deleted_count} 条重复记录")

        # 3. 创建临时表（带唯一约束）
        print("正在创建带有唯一约束的新表...")
        cursor.execute("""
            CREATE TABLE url_sources_new (
                id INTEGER PRIMARY KEY,
                agent_id VARCHAR(50) NOT NULL REFERENCES agents(id),
                url VARCHAR(1000) NOT NULL,
                normalized_url VARCHAR(1000) NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                last_fetch_at TIMESTAMP,
                last_error TEXT,
                title VARCHAR(500),
                content TEXT,
                content_hash VARCHAR(64),
                fetch_metadata JSON,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP,
                UNIQUE(agent_id, normalized_url)
            )
        """)

        # 4. 复制数据
        print("正在复制数据...")
        cursor.execute("""
            INSERT INTO url_sources_new
            SELECT * FROM url_sources
        """)
        copied_count = cursor.rowcount
        print(f"  复制了 {copied_count} 条记录")

        # 5. 删除旧表并重命名新表
        print("正在替换表...")
        cursor.execute("DROP TABLE url_sources")
        cursor.execute("ALTER TABLE url_sources_new RENAME TO url_sources")

        # 6. 重新创建索引
        print("正在重建索引...")
        cursor.execute("CREATE INDEX ix_url_sources_agent_id ON url_sources (agent_id)")
        cursor.execute("CREATE INDEX ix_url_sources_url ON url_sources (url)")
        cursor.execute("CREATE INDEX ix_url_sources_normalized_url ON url_sources (normalized_url)")
        cursor.execute("CREATE INDEX ix_url_sources_status ON url_sources (status)")
        cursor.execute("CREATE INDEX ix_url_sources_agent_status ON url_sources (agent_id, status)")

        # 7. 提交事务
        conn.commit()
        print("✅ 迁移完成！")

        # 验证
        cursor.execute("SELECT COUNT(*) FROM url_sources")
        final_count = cursor.fetchone()[0]
        print(f"最终记录数: {final_count}")

        return True

    except Exception as e:
        print(f"❌ 迁移失败: {e}")
        conn.rollback()
        # 恢复备份
        shutil.copy2(backup_path, db_path)
        print(f"已从备份恢复数据库")
        return False

    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
